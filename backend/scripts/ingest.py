import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database.connection import SessionLocal
from app.ingestion.pipeline import run_structured_ingestion, run_unstructured_ingestion

def main():
    db = SessionLocal()
    try:
        csv_file = "../data/sample/raw_properties.csv"
        pdf_file = "../data/sample/sample_brochure.pdf"
        
        print("Starting Data Ingestion Pipeline...")
        run_structured_ingestion(csv_file, db)
        run_unstructured_ingestion(pdf_file, source="ABC Residency Brochure PDF")
        print("Ingestion Pipeline Executed Successfully!")
    finally:
        db.close()

if __name__ == "__main__":
    main()