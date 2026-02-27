import requests
from bs4 import BeautifulSoup
import os

# Define your credentials via environment variables.
email = os.environ.get("TMUA_EMAIL")
password = os.environ.get("TMUA_PASSWORD")
if not email or not password:
    raise RuntimeError("Set TMUA_EMAIL and TMUA_PASSWORD environment variables before running.")
# URLs
login_url = "https://tmua.exams.ninja/login"
questions_url = "https://tmua.exams.ninja/practice-dojo/practice"

# Start a session to maintain cookies
session = requests.Session()

# Fetch the login page to get the CSRF token and session cookies
login_page_response = session.get(login_url)

# Check if the request was successful
if login_page_response.status_code != 200:
    print(f"Failed to fetch the login page. Status code: {login_page_response.status_code}")
    exit()

# Parse the HTML to extract the CSRF token
soup = BeautifulSoup(login_page_response.text, 'html.parser')
csrf_token_input = soup.find('input', {'name': '_token'})

if not csrf_token_input:
    print("Failed to find CSRF token in the page.")
    exit()

csrf_token = csrf_token_input['value']

# Headers for the POST request
headers = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "max-age=0",
    "content-type": "application/x-www-form-urlencoded",
    "sec-ch-ua": "\"Chromium\";v=\"117\", \"Not;A=Brand\";v=\"8\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "referrer": login_url,
    "referrerPolicy": "strict-origin-when-cross-origin"
}

# Data for the login POST request
login_data = {
    "email": email,
    "password": password,
    "_token": csrf_token,  # Use the extracted CSRF token
    "remember": "on"  # Optional: to keep the session
}

# Make the POST request to log in
login_response = session.post(login_url, headers=headers, data=login_data)

# Check if login was successful
if login_response.status_code == 200:
    print("Login successful!")
else:
    print(f"Failed to log in. Status code: {login_response.status_code}")
    exit()

# Now fetch the questions page to ensure the session is properly established
questions_page_response = session.get("https://tmua.exams.ninja/practice-dojo")

# Check if the request was successful
if questions_page_response.status_code != 200:
    print(f"Failed to fetch the questions page. Status code: {questions_page_response.status_code}")
    exit()

# Parse the HTML to extract the new CSRF token
soup = BeautifulSoup(questions_page_response.text, 'html.parser')
csrf_token_input = soup.find('input', {'name': '_token'})

if not csrf_token_input:
    print("Failed to find CSRF token on the questions page.")
    exit()

csrf_token = csrf_token_input['value']

# Headers for the questions POST request
questions_headers = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "max-age=0",
    "content-type": "application/x-www-form-urlencoded",
    "sec-ch-ua": "\"Chromium\";v=\"117\", \"Not;A=Brand\";v=\"8\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "referrer": questions_url,
    "referrerPolicy": "strict-origin-when-cross-origin"
}

# Data for the questions POST request
questions_data = {
    "section": "2",
    "subject[2]": "2",
    "numberofquestions": "35",  # Request 35 questions
    "_token": csrf_token  # Use the extracted CSRF token
}

# Make the POST request to get questions
questions_response = session.post(questions_url, headers=questions_headers, data=questions_data)

# Check if fetching questions was successful
if questions_response.status_code == 200:
    print("Questions fetched successfully!")
    soup = BeautifulSoup(questions_response.text, 'html.parser')

    questions_list = []

    questions = soup.find_all('div', class_='row question')  # Adjust this selector based on actual HTML structure
    for question in questions:
        question_text = question.find('div', class_='question2').get_text(strip=True)
        options = []
        option_divs = question.find_all('div', class_='question_answer')
        for opt in option_divs:
            option_label = opt.find('div', class_='abcde').get_text(strip=True)
            option_text = opt.find('div', class_='question-option').get_text(strip=True)
            options.append(f"{option_label}. {option_text}")
        question_dict = {
            'question': question_text,
            'options': options,
        }
        questions_list.append(question_dict)

    # Format questions and options using LaTeX syntax
    latex_str = ""
    for idx, q in enumerate(questions_list, 1):
        latex_str += f"\\textbf{{Question {idx}}}\n\n"
        latex_str += f"{q['question']}\n\n"
        for option in q['options']:
            latex_str += f"{option}\n\n"
        latex_str += "\n"

    # Write the LaTeX string to a file
    with open("questions.tex", "w", encoding="utf-8") as f:
        f.write(latex_str)

    print("Questions saved to questions.tex")

else:
    print(f"Failed to fetch questions. Status code: {questions_response.status_code}")
    print(questions_response.text)
