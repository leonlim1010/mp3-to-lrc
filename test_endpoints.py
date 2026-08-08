import requests

BASE_URL = "http://127.0.0.1:8000"

def test_endpoints():
    print("Testing `/list_mp3` endpoint...")
    
    r = requests.get(f"{BASE_URL}/list_mp3")
    print("=> Status:", r.status_code)
    try:
        print("=> JSON:", r.json())
    except Exception as e:
        print("=> Error parsing JSON:", e)

if __name__ == "__main__":
    test_endpoints()
