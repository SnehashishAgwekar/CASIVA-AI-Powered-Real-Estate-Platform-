import pandas as pd
from sqlalchemy.orm import Session
from app.database.models import PropertyModel
from app.ingestion.cleaner import clean_structured_data
from app.ingestion.pdf_processor import extract_and_chunk_pdf
from app.rag.vector_db import qdrant_client, COLLECTION_NAME, init_qdrant_collection
from fastembed import TextEmbedding

def run_structured_ingestion(csv_path: str, db: Session):
    """Reads CSV, cleans data, and inserts unique records into PostgreSQL."""
    df = pd.read_csv(csv_path)
    clean_df = clean_structured_data(df)
    
    inserted_count = 0
    for _, row in clean_df.iterrows():
        # Check if record already exists in DB
        existing = db.query(PropertyModel).filter_by(
            property_name=row['property_name'],
            city=row['city'],
            bhk=int(row['bhk'])
        ).first()
        
        if not existing:
            prop = PropertyModel(
                property_name=row['property_name'],
                city=row['city'],
                location=row['location'],
                price_in_inr=float(row['price_in_inr']),
                bhk=int(row['bhk']),
                area_sqft=float(row['area_sqft']),
                property_type=row['property_type'],
                builder_name=row.get('builder_name'),
                amenities=row.get('amenities'),
                source=row['source'],
                source_url=row.get('source_url')
            )
            db.add(prop)
            inserted_count += 1
            
    db.commit()
    print(f"Structured Ingestion Complete: Inserted {inserted_count} new properties into PostgreSQL.")

def run_unstructured_ingestion(pdf_path: str, source: str, id_offset: int = 100):
    """Chunks PDF document, generates embeddings, and inserts points into Qdrant."""
    init_qdrant_collection()
    chunks = extract_and_chunk_pdf(pdf_path)

    embedding_model = TextEmbedding()
    embeddings = list(embedding_model.embed(chunks))

    points = []
    for idx, (chunk, vector) in enumerate(zip(chunks, embeddings)):
        points.append({
            "id": idx + id_offset,
            "vector": vector.tolist(),
            "payload": {
                "document": chunk,
                "source": source,
                "file_path": pdf_path
            }
        })

    qdrant_client.upsert(collection_name=COLLECTION_NAME, points=points)
    print(f"Unstructured Ingestion Complete: Uploaded {len(points)} vector chunks to Qdrant.")