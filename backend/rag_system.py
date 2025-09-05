import os
import json
import numpy as np
import faiss
from sentence_transformers import SentenceTransformer
from typing import List, Dict, Any, Optional, Tuple
import hashlib
from pathlib import Path

class RAG:
    # all-MiniLM-L6-v2 (sentence transformers from hugging face) used for vectorisation to be used for semantic search
    def __init__(self, model_name: str = "all-MiniLM-L6-v2", cache_dir: str = "./rag_cache"):
        self.model_name = model_name
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)
        
        # initialise sentence transformer model
        self.encoder = SentenceTransformer(model_name)
        # get size of each vector in embedding
        self.embedding_dim = self.encoder.get_sentence_embedding_dimension()
        
        # storage for book data
        self.book_indices = {}  # book_id : FAISS index
        self.book_chunks = {}   # book_id : list of chunk metadata
        self.book_embeddings = {}  # book_id : numpy array of embeddings
            
    def _get_book_hash(self, book_id: str) -> str:
        # generate a hash for book ID to use as filename
        return hashlib.md5(book_id.encode()).hexdigest()
    
    def _get_cache_paths(self, book_id: str) -> Dict[str, Path]:
        # get cache file paths for a book
        book_hash = self._get_book_hash(book_id)
        return {
            'index': self.cache_dir / f"{book_hash}.faiss",
            'chunks': self.cache_dir / f"{book_hash}_chunks.json",
            'embeddings': self.cache_dir / f"{book_hash}_embeddings.npy"
        }
    
    def load_book_cache(self, book_id: str) -> bool:
        # load cached embeddings and index for a book
        # returns true if cache was loaded successfully; false otherwise
        try:
            paths = self._get_cache_paths(book_id)
            # check if all cache files exist
            if not all(path.exists() for path in paths.values()):
                return False
            # load FAISS index
            index = faiss.read_index(str(paths['index']))
            
            # load chunk metadata
            with open(paths['chunks'], 'r', encoding='utf-8') as f:
                chunks = json.load(f)
            
            # load embeddings
            embeddings = np.load(str(paths['embeddings']))
            
            # store in memory
            self.book_indices[book_id] = index
            self.book_chunks[book_id] = chunks
            self.book_embeddings[book_id] = embeddings
            
            return True
            
        except Exception as e:
            print(f"Failed to load cache for book {book_id}: {e}")
            return False
    
    def save_book_cache(self, book_id: str) -> bool:
        # save embeddings and index for a book to cache
        # returns true if saving successful; false otherwise
        try:
            if book_id not in self.book_indices:
                return False
                
            paths = self._get_cache_paths(book_id)
            
            # save FAISS index
            faiss.write_index(self.book_indices[book_id], str(paths['index']))
            # save chunk metadata
            with open(paths['chunks'], 'w', encoding='utf-8') as f:
                json.dump(self.book_chunks[book_id], f, ensure_ascii=False, indent=2)
            # save embeddings
            np.save(str(paths['embeddings']), self.book_embeddings[book_id])

            return True
            
        except Exception as e:
            print(f"Failed to save cache for book {book_id}: {e}")
            return False
    
    def process_book_chunks(self, book_id: str, chunks: List[Dict[str, Any]]) -> bool:
        # process book chunks       
        # true if processing succesful
        try:
            # Try to load from cache first
            if self.load_book_cache(book_id):
                return True
            
            # extract text content for embedding
            texts = [chunk['text'] for chunk in chunks]
            
            # generate embeddings
            embeddings = self.encoder.encode(texts, show_progress_bar=True)
            embeddings = np.array(embeddings).astype('float32')
            
            # create FAISS index
            index = faiss.IndexFlatIP(self.embedding_dim)  # IP (= inner product) for cosine similarity
            
            # normalise embeddings for cosine similarity
            # L2 distance and cosine similarity are related through an equation where decreasing L2 dist increases similarity
            faiss.normalize_L2(embeddings)
            index.add(embeddings)
            
            # store in memory
            self.book_indices[book_id] = index
            self.book_chunks[book_id] = chunks
            self.book_embeddings[book_id] = embeddings
            
            # save to cache
            self.save_book_cache(book_id)
            
            return True
            
        except Exception as e:
            print(f"Error processing book chunks for {book_id}: {e}")
            return False
    
    def search_similar_chunks(
        self, 
        book_id: str, 
        query: str, 
        top_k: int = 5,
        up_to_page: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        # search for similar chunks using semantic similarity.
        # returns list of similar chunks with similarity scores
        # TODO: reranking (now we only select (a bit more than) top_k, but it would be better if we could improve LLM recall at some cost to retreiver recall)
        # though it can slow things down
        try:
            if book_id not in self.book_indices:
                print(f"No index found for book {book_id}")
                return []
            
            # generate query embedding
            query_embedding = self.encoder.encode([query])
            query_embedding = np.array(query_embedding).astype('float32')
            faiss.normalize_L2(query_embedding)
            
            # search in FAISS index
            index = self.book_indices[book_id]
            chunks = self.book_chunks[book_id]
            
            # get more results than needed for filtering
            search_k = min(top_k * 3, len(chunks))
            scores, indices = index.search(query_embedding, search_k)
            
            # prepare results
            results = []
            for score, idx in zip(scores[0], indices[0]):
                if idx >= len(chunks):
                    continue
                    
                chunk = chunks[idx].copy()
                chunk['similarity_score'] = float(score)
                
                # apply page filtering if specified
                if up_to_page is not None:
                    chunk_page = chunk.get('page_number')
                    if chunk_page is not None and chunk_page > up_to_page:
                        continue
                
                results.append(chunk)
                
                # stop when we have enough results
                if len(results) >= top_k:
                    break

            return results
            
        except Exception as e:
            print(f"Error searching chunks for book {book_id}: {e}")
            return []
    
    def clear_book_cache(self, book_id: str) -> bool:
        # clear cached data for a specific book
        # used when book dismounted from library
        try:
            # remove from memory
            if book_id in self.book_indices:
                del self.book_indices[book_id]
            if book_id in self.book_chunks:
                del self.book_chunks[book_id]
            if book_id in self.book_embeddings:
                del self.book_embeddings[book_id]
            
            # remove cache files
            paths = self._get_cache_paths(book_id)
            for path in paths.values():
                if path.exists():
                    path.unlink()
            
            return True
            
        except Exception as e:
            print(f"Error clearing cache for book {book_id}: {e}")
            return False


# global RAG system instance
rag_system = None

def get_rag_system() -> RAG:
    # get or create the global RAG system instance
    global rag_system
    if rag_system is None:
        rag_system = RAG()
    return rag_system

def prepare_chunks_for_rag(chunks: List[str], book_title: str = None) -> List[Dict[str, Any]]:
    # convert simple text chunks into a RAG-compatible format
    # returns list of chunk dictionaries now suitable for RAG processing
    rag_chunks = []
    for i, chunk_text in enumerate(chunks):
        chunk_dict = {
            'text': chunk_text,
            'chunk_index': i,
            'metadata': {
                'book_title': book_title,
                'chunk_length': len(chunk_text)
            }
        }
        rag_chunks.append(chunk_dict)
    
    return rag_chunks
