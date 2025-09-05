import os
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import re
from typing import List, Dict, Any, Optional
from rag_system import get_rag_system, prepare_chunks_for_rag
from collections import Counter

load_dotenv()

# config
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
COHERE_API_KEY = os.getenv("COHERE_API_KEY")
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
COHERE_API_URL = "https://api.cohere.ai/v1/chat"
PRIMARY_MODEL = "deepseek/deepseek-chat-v3-0324:free"
FALLBACK_MODEL = "moonshotai/kimi-k2:free"
COHERE_MODEL = "command-r-plus-08-2024"

app = FastAPI()

# add CORS middleware
# AI-gen: adds a bunch of possible origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",  # vite dev server
        "http://localhost:1420", "http://127.0.0.1:1420",  # tauri dev server
        "http://localhost:3000",  # alternative dev server
        "tauri://localhost",  # tauri production
        "https://tauri.localhost"  # tauri production alternative
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SummarizeRequest(BaseModel):
    chunks: list[str] # text chunks to use as context
    book_title: str | None = None

class SummarizeChunkRequest(BaseModel):
    chunk_text: str
    book_title: str | None = None
    chunk_id: str
    is_continuation: bool = False  # true if this continues from previous chunks

class SummarizeResponse(BaseModel):
    summary: str

class QuestionRequest(BaseModel):
    question: str
    chunks: list[str]  # text chunks to use as context
    book_title: str | None = None
    context_scope: str = "pages_so_far"  # "pages_so_far" or "complete_book" TODO: custom page range
    conversation_history: list[dict] | None = None  # previous qna pairs

class QuestionResponse(BaseModel):
    answer: str
    relevant_chunks_used: int
    context_scope: str

class HealthResponse(BaseModel):
    status: str
    api_key_configured: bool
    model: str

class RAGRequest(BaseModel):
    user_question: str
    book_id: str
    chunks: List[str]  # text chunks for initial processing
    book_title: Optional[str] = None
    up_to_page: Optional[int] = None  # restrict context to pages up to this number
    top_k: int = 5  # number of similar chunks to retrieve

class RAGResponse(BaseModel):
    answer: str
    chunks_used: int
    similarity_scores: List[float]
    book_id: str
    up_to_page: Optional[int] = None

# clean and optimise text for summarisation by removing unnecessary elements
def clean_text_for_summarisation(text: str) -> str:
    # remove excessive whitespace and normalise
    text = re.sub(r'\s+', ' ', text.strip())
    
    # remove common EPUB artifacts
    text = re.sub(r'\[\d+\]', '', text)  # remove reference numbers like [1], [2]
    text = re.sub(r'\b(Chapter|CHAPTER)\s+\d+\b', '', text)  # remove chapter headers
    text = re.sub(r'\bPage\s+\d+\b', '', text)  # remove page numbers
    
    # remove excessive punctuation
    text = re.sub(r'\.{3,}', '...', text)  # normalise ellipses
    text = re.sub(r'-{2,}', '--', text)  # normalise dashes
    
    # remove very short fragments (likely artifacts)
    sentences = text.split('. ')
    sentences = [s for s in sentences if len(s.strip()) > 10]
    
    return '. '.join(sentences)

# roughestimation of tokens (1 token ~ 4 characters)
def estimate_tokens(text: str) -> int:
    return len(text) // 4

# truncate content to fit within content limit
def truncate_content(chunks: list[str], max_tokens: int = 7000) -> str:
    # clean all chunks
    cleaned_chunks = [clean_text_for_summarisation(chunk) for chunk in chunks if chunk.strip()]
    # start with all content and progressively reduce if needed
    full_content = "\n\n".join(cleaned_chunks)
    if estimate_tokens(full_content) <= max_tokens:
        return full_content
    # strategy 1: take first n chunks that fit
    accumulated_content = ""
    for chunk in cleaned_chunks:
        test_content = accumulated_content + "\n\n" + chunk if accumulated_content else chunk
        if estimate_tokens(test_content) > max_tokens:
            break
        accumulated_content = test_content
    # strategy 2: if we have very little content, try to include more by taking alternating chunks
    if estimate_tokens(accumulated_content) < max_tokens * 0.3:  # Less than 30% of limit
        # take every other chunk to get broader coverage
        selected_chunks = cleaned_chunks[::2]  # every 2nd chunk
        accumulated_content = "\n\n".join(selected_chunks)
        
        # if still too long, take every 3rd chunk
        if estimate_tokens(accumulated_content) > max_tokens:
            selected_chunks = cleaned_chunks[::3]  # every 3rd chunk
            accumulated_content = "\n\n".join(selected_chunks)
    
    # final safety truncation
    if estimate_tokens(accumulated_content) > max_tokens:
        # truncate to approximately max_tokens * 4 characters
        char_limit = max_tokens * 4
        accumulated_content = accumulated_content[:char_limit]
        # try to end at a sentence boundary
        last_period = accumulated_content.rfind('. ')
        if last_period > char_limit * 0.8:  # if we can find a period in the last 20%
            accumulated_content = accumulated_content[:last_period + 1]
    
    return accumulated_content

# find the most relevant chunks for a query using simple keyword matching
def find_relevant_chunks(question: str, chunks: list[str], max_chunks: int = 5) -> list[str]:
    # extract keywords from the question (remove common words)
    stop_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'what', 'where', 'when', 'why', 'how', 'who', 'which'}
    
    question_words = re.findall(r'\\b\\w+\\b', question.lower())
    keywords = [word for word in question_words if word not in stop_words and len(word) > 2]
    
    if not keywords:
        # if no keywords found, return first few chunks
        return chunks[:max_chunks]
    
    # score each chunk based on keyword matches
    chunk_scores = []
    for i, chunk in enumerate(chunks):
        if not chunk or not chunk.strip():
            continue
            
        chunk_lower = chunk.lower()
        score = 0
        
        # count keyword matches (with some weighting)
        for keyword in keywords:
            # exact word matches get higher score
            exact_matches = len(re.findall(r'\\b' + re.escape(keyword) + r'\\b', chunk_lower))
            score += exact_matches * 3
            
            # partial matches get lower score
            if keyword in chunk_lower:
                score += 1
        
        # longer chunks get slight bonus (more context)
        score += min(len(chunk) / 1000, 2)
        
        chunk_scores.append((score, i, chunk))
    
    # sort by score (descending) and take top chunks
    chunk_scores.sort(key=lambda x: x[0], reverse=True)
    
    # return the top chunks, maintaining some order
    selected_chunks = []
    selected_indices = []
    
    for score, idx, chunk in chunk_scores[:max_chunks * 2]:  # get more candidates
        if score > 0:  # only include chunks with some relevance
            selected_chunks.append((idx, chunk))
            selected_indices.append(idx)
    
    # sort selected chunks by their original order in the book
    selected_chunks.sort(key=lambda x: x[0])
    
    # return just the chunk text, limited to max_chunks
    return [chunk for _, chunk in selected_chunks[:max_chunks]]

# prepare the context for qna with relevant chunks and conversation history
def prepare_qa_context(question: str, relevant_chunks: list[str], book_title: str = None, conversation_history: list[dict] = None) -> str:    
    context_parts = []
    
    if book_title:
        context_parts.append(f"Book: {book_title}")
    
    if relevant_chunks:
        context_parts.append("\nRelevant content from the book:")
        for i, chunk in enumerate(relevant_chunks, 1):
            cleaned_chunk = clean_text_for_summarisation(chunk)
            if cleaned_chunk.strip():
                context_parts.append(f"\n[Context {i}]\n{cleaned_chunk}")
    
    if conversation_history:
        context_parts.append("\nPrevious conversation:")
        for qa in conversation_history[-3:]:  # only include last 3 qna pairs
            if 'question' in qa and 'answer' in qa:
                context_parts.append(f"\nQ: {qa['question']}\nA: {qa['answer']}")
    
    context_parts.append(f"\nCurrent question: {question}")
    
    return "\n".join(context_parts)

# call OpenRouter API with primary model (secondary model as fallback)
async def call_openrouter_api(messages: List[Dict[str, str]], max_tokens: int = 300, temperature: float = 0.7) -> str:    
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OpenRouter API key not configured.")
    
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    
    models_to_try = [PRIMARY_MODEL, FALLBACK_MODEL]
    
    for model_name in models_to_try:
        payload = {
            "model": model_name,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": 0.9,
        }
        
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(OPENROUTER_API_URL, json=payload, headers=headers)
                
                if response.status_code == 200:
                    data = response.json()
                    
                    summary = ""
                    if "choices" in data and len(data["choices"]) > 0:
                        choice = data["choices"][0]
                        if "message" in choice and "content" in choice["message"]:
                            summary = choice["message"]["content"]
                        elif "text" in choice:
                            summary = choice["text"]
                    
                    if summary:
                        return summary.strip()
                    else:
                        continue
                        
                else:
                    error_text = response.text
                    print(f"Error from {model_name} ({response.status_code}): {error_text}")
                    
                    # if it's a rate limit or temporary error, try the fallback
                    if response.status_code in [429, 502, 503, 504]:
                        continue
                    else:
                        # for other errors, don't try fallback
                        raise HTTPException(status_code=502, detail=f"API error from {model_name} ({response.status_code}): {error_text}")
                        
        except httpx.RequestError as e:
            print(f"HTTP request error with {model_name}: {str(e)}")
            continue
        except httpx.TimeoutException as e:
            print(f"Request timeout with {model_name}: {str(e)}")
            continue
    
    # if we get here, all models failed
    raise HTTPException(status_code=502, detail="All AI models failed to generate summary")

# call cohere API as a third fallback option
async def call_cohere_api(message: str, max_tokens: int = 300, temperature: float = 0.7) -> str:
    if not COHERE_API_KEY:
        raise HTTPException(status_code=500, detail="Cohere API key not configured.")
    
    headers = {
        "Authorization": f"Bearer {COHERE_API_KEY}",
        "Content-Type": "application/json",
    }
    
    payload = {
        "model": COHERE_MODEL,
        "messages": [{"role": "user", "content": message}],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(COHERE_API_URL, json=payload, headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                
                # cohere API response format
                if "message" in data and "content" in data["message"]:
                    content = data["message"]["content"]
                    if isinstance(content, list) and len(content) > 0:
                        summary = content[0].get("text", "")
                    else:
                        summary = str(content)
                    
                    if summary:
                        return summary.strip()
                
                print(f"No summary found in Cohere response: {data}")
                raise HTTPException(status_code=502, detail="No summary found in Cohere response")
                
            else:
                error_text = response.text
                print(f"Error from Cohere ({response.status_code}): {error_text}")
                raise HTTPException(status_code=502, detail=f"Cohere API error ({response.status_code}): {error_text}")
                
    except httpx.RequestError as e:
        print(f"HTTP request error with Cohere: {str(e)}")
        raise HTTPException(status_code=502, detail=f"Cohere request error: {str(e)}")
    except httpx.TimeoutException as e:
        print(f"Request timeout with Cohere: {str(e)}")
        raise HTTPException(status_code=502, detail=f"Cohere timeout error: {str(e)}")

# call the AI APIs
async def call_ai_with_fallback(messages: List[Dict[str, str]], max_tokens: int = 300, temperature: float = 0.7) -> str:
    # first try OpenRouter with both models
    try:
        return await call_openrouter_api(messages, max_tokens, temperature)
    except HTTPException as e:
        print(f"OpenRouter failed: {e.detail}")
        
        # if OpenRouter completely failed, try Cohere as final fallback
        if COHERE_API_KEY:
            try:
                # convert messages to single prompt for Cohere
                prompt_parts = []
                for msg in messages:
                    if msg["role"] == "system":
                        prompt_parts.append(f"Instructions: {msg['content']}")
                    elif msg["role"] == "user":
                        prompt_parts.append(msg["content"])
                
                combined_prompt = "\n\n".join(prompt_parts)
                return await call_cohere_api(combined_prompt, max_tokens, temperature)
                
            except Exception as cohere_error:
                print(f"Cohere also failed: {str(cohere_error)}")
                raise HTTPException(status_code=502, detail=f"All AI services failed. OpenRouter: {e.detail}, Cohere: {str(cohere_error)}")
        else:
            raise HTTPException(status_code=502, detail=f"OpenRouter failed and Cohere not configured: {e.detail}")

# generic health check endpoint to verify API config
@app.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(
        status="ok",
        api_key_configured=bool(OPENROUTER_API_KEY),
        model=PRIMARY_MODEL
    )

# summarise a single chunk/section of text
@app.post("/summarize-chunk", response_model=SummarizeResponse)
async def summarize_chunk(request: SummarizeChunkRequest):
    if not request.chunk_text or not request.chunk_text.strip():
        raise HTTPException(status_code=400, detail="Chunk text must be provided.")

    # clean the chunk text
    cleaned_text = clean_text_for_summarisation(request.chunk_text)
    
    if not cleaned_text.strip():
        raise HTTPException(status_code=400, detail="No meaningful content found after cleaning.")

    # check if content fits within limits
    if estimate_tokens(cleaned_text) > 15000:
        # truncate if still too long
        char_limit = 15000 * 4
        cleaned_text = cleaned_text[:char_limit]
        last_period = cleaned_text.rfind('. ')
        if last_period > char_limit * 0.8:
            cleaned_text = cleaned_text[:last_period + 1]

    system_prompt = (
        "You are a reading assistant for an EPUB reader. "
        "Summarize the provided text section concisely. "
        "Focus on key plot points, character development, and important events. "
        "Keep the summary detailed enough to understand what happened, but concise. "
        "Do NOT speculate about future events. "
        "Return only plain text, without any special symbols, section numbers, headings, or formatting."
    )
    
    if request.is_continuation:
        system_prompt += " This section continues from previous parts of the book."
    
    user_prompt = f"Book: {request.book_title}\n" if request.book_title else ""
    user_prompt += f"Section ID: {request.chunk_id}\n"
    user_prompt += f"Text to summarize:\n{cleaned_text}"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]
    
    try:
        summary = await call_ai_with_fallback(messages, max_tokens=400, temperature=0.7)
        return SummarizeResponse(summary=summary)
    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/summarize", response_model=SummarizeResponse)
async def summarize(request: SummarizeRequest):
    if not request.chunks or not isinstance(request.chunks, list):
        raise HTTPException(status_code=400, detail="Chunks must be a non-empty list.")

    context = truncate_content(request.chunks, max_tokens=12000)
    
    if not context.strip():
        raise HTTPException(status_code=400, detail="No meaningful content found after processing.")

    system_prompt = (
        "You are a reading assistant for an EPUB reader. "
        "Summarize only the content provided. "
        "Do NOT speculate about what happens next. "
        "Only include content the author has revealed so far. "
        "Avoid spoilers and speculation. "
        "Focus on key plot points, character development, and important themes. "
        "Return only plain text, without any special symbols, section numbers, headings, or formatting."
    )
    user_prompt = f"Book Title: {request.book_title}\n" if request.book_title else ""
    user_prompt += f"Content so far:\n{context}"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]
    
    try:
        summary = await call_ai_with_fallback(messages, max_tokens=500, temperature=0.7)
        return SummarizeResponse(summary=summary)
    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# answer a question using book content as context (RAG)
@app.post("/ask-question", response_model=QuestionResponse)
async def ask_question(request: QuestionRequest):
    if not request.question or not request.question.strip():
        raise HTTPException(status_code=400, detail="Question must be provided.")
    
    if not request.chunks or not isinstance(request.chunks, list):
        raise HTTPException(status_code=400, detail="Chunks must be a non-empty list.")
    
    # find relevant chunks for the question
    relevant_chunks = find_relevant_chunks(request.question, request.chunks, max_chunks=5)
    
    if not relevant_chunks:
        raise HTTPException(status_code=400, detail="No relevant content found for the question.")
    
    # prepare context with relevant chunks and conversation history
    context = prepare_qa_context(
        request.question, 
        relevant_chunks, 
        request.book_title, 
        request.conversation_history
    )
    
    # check token limits
    if estimate_tokens(context) > 12000:
        # reduce number of chunks if context is too long
        relevant_chunks = relevant_chunks[:3]
        context = prepare_qa_context(
            request.question, 
            relevant_chunks, 
            request.book_title, 
            request.conversation_history
        )
    
    system_prompt = (
        "You are a helpful reading assistant for an EPUB reader. "
        "Answer the user's question based ONLY on the provided book content. "
        "If the answer is not in the provided context, say so clearly. "
        "Do not make up information or speculate beyond what's provided. "
        "Be concise but thorough in your response. "
        "If referencing specific parts of the book, mention which context section it came from."
    )
    
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": context}
    ]
    
    try:
        answer = await call_ai_with_fallback(messages, max_tokens=600, temperature=0.3)
        return QuestionResponse(
            answer=answer,
            relevant_chunks_used=len(relevant_chunks),
            context_scope=request.context_scope
        )
    except Exception as e:
        print(f"Unexpected error in Q&A: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# answer questions using RAG with semantic search
@app.post("/qa", response_model=RAGResponse)
async def qa_with_rag(request: RAGRequest):
    if not request.user_question or not request.user_question.strip():
        raise HTTPException(status_code=400, detail="Question must be provided.")
    
    if not request.book_id or not request.book_id.strip():
        raise HTTPException(status_code=400, detail="Book ID must be provided.")
    
    if not request.chunks or not isinstance(request.chunks, list):
        raise HTTPException(status_code=400, detail="Chunks must be a non-empty list.")
    
    try:
        # get RAG system instance
        rag = get_rag_system()
        
        # prepare chunks for RAG processing
        rag_chunks = prepare_chunks_for_rag(request.chunks, request.book_title)
        
        # process book chunks
        success = rag.process_book_chunks(request.book_id, rag_chunks)
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to process book chunks for RAG")
        
        # search for similar chunks using semantic similarity
        similar_chunks = rag.search_similar_chunks(
            book_id=request.book_id,
            query=request.user_question,
            top_k=request.top_k,
            up_to_page=request.up_to_page
        )
        
        if not similar_chunks:
            raise HTTPException(status_code=404, detail="No relevant content found for the question.")
        
        # extract text and similarity scores
        chunk_texts = [chunk['text'] for chunk in similar_chunks]
        similarity_scores = [chunk['similarity_score'] for chunk in similar_chunks]
        
        # prepare context for AI model
        context_parts = []
        if request.book_title:
            context_parts.append(f"Book: {request.book_title}")
        
        context_parts.append(f"Question: {request.user_question}")
        context_parts.append("\nIMPORTANT: Answer ONLY based on the content below. Do not use external knowledge.") # had to add this 😭
        context_parts.append("\nRelevant content from the book:")
        
        for i, (chunk_text, score) in enumerate(zip(chunk_texts, similarity_scores)):
            context_parts.append(f"\n--- Context {i+1} (similarity: {score:.3f}) ---")
            context_parts.append(chunk_text)
        
        context = "\n".join(context_parts)
        
        # check token limits and truncate if necessary
        if estimate_tokens(context) > 12000:
            # use fewer chunks if context is too long
            reduced_chunks = similar_chunks[:3]
            chunk_texts = [chunk['text'] for chunk in reduced_chunks]
            similarity_scores = [chunk['similarity_score'] for chunk in reduced_chunks]
            
            context_parts = []
            if request.book_title:
                context_parts.append(f"Book: {request.book_title}")
            
            context_parts.append(f"Question: {request.user_question}")
            context_parts.append("\nIMPORTANT: Answer ONLY based on the content below. Do not use external knowledge.")
            context_parts.append("\nRelevant content from the book:")
            
            for i, (chunk_text, score) in enumerate(zip(chunk_texts, similarity_scores)):
                context_parts.append(f"\n--- Context {i+1} (similarity: {score:.3f}) ---")
                context_parts.append(chunk_text)
            
            context = "\n".join(context_parts)
        
        # prepare messages
        system_prompt = (
            "You are a helpful reading assistant for an EPUB reader. "
            "CRITICAL: Answer the user's question based ONLY on the provided book content below. "
            "DO NOT use any external knowledge about books, characters, or plots. "
            "If information is not explicitly stated in the provided context, you MUST say 'This information is not available in the provided context.' "
            "Never mention character names, plot details, or other information unless it appears verbatim in the context. "
            "The content has been retrieved using semantic similarity search. "
            "Be concise but thorough in your response. "
            "Reference the similarity scores if helpful to indicate confidence in the retrieved content."
        )
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": context}
        ]

        # call AI model with fallback
        answer = await call_ai_with_fallback(messages, max_tokens=600, temperature=0.3)
        
        return RAGResponse(
            answer=answer,
            chunks_used=len(chunk_texts),
            similarity_scores=similarity_scores,
            book_id=request.book_id,
            up_to_page=request.up_to_page
        )
        
    except HTTPException:
        # re-raise the HTTP exception
        raise
    except Exception as e:
        print(f"Unexpected error in RAG Q&A: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
