from fastapi import FastAPI
from datetime import datetime, date
import requests

app = FastAPI()

def get_upcoming_quarter():
    """Calculates the start and end dates of the upcoming quarter."""
    today = date.today()
    current_month = today.month
     # Determine the start month of the next quarter
    if current_month in [1, 2, 3]:
        start_date = date(today.year, 4, 1)
        end_date = date(today.year, 6, 30)
    elif current_month in [4, 5, 6]:
        start_date = date(today.year, 7, 1)
        end_date = date(today.year, 9, 30)
    elif current_month in [7, 8, 9]:
        start_date = date(today.year, 10, 1)
        end_date = date(today.year, 12, 31)
    else: # Q4, so next quarter is Q1 of next year
        start_date = date(today.year + 1, 1, 1)
        end_date = date(today.year + 1, 3, 31)
    return start_date.isoformat(), end_date.isoformat()

@app.get("/")
def read_holidays():
    start, end = get_upcoming_quarter()
    
    # Hebcal API endpoint for Jewish holidays
    # v=1 (Hebcal v1 API), cfg=json (JSON response)
    # maj=on (major holidays), min=on (minor holidays)
    url = f"https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&start={start}&end={end}"
    
    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
            # Format the response to only show names and dates
        holidays = []
        for item in data.get('items', []):
            holidays.append({
                "name": item.get('title'),
                "date": item.get('date')
            })
            return {
            "quarter_start": start,
            "quarter_end": end,
            "holidays": holidays
        }
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)