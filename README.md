# Study Tracker and Planner

## Description

### `study_plan.ipynb`
This Jupyter notebook generates a study plan for the current day and the next day. It calculates the available study time between 9 AM and 5 PM, considering a 5-minute break between 40-minute study blocks. The study blocks are allocated to each subject based on their weighting. The notebook also ensures that no study blocks are added during the lunch hour (12:30 PM - 1:30 PM). The generated study plan is then inserted into the specified Google Calendar.

### `todays_studying.ipynb`
This Jupyter notebook provides statistics on your studying time for today so you can run this while you are studying to see your progress. It fetches the studying hours for the current day from your Google Calendar and calculates the percentage of planned studying hours completed. It also calculates the average studying hours over the last week and month. The notebook presents this data in a clear and concise manner, allowing you to track your studying progress effectively.

### `study_stats.py`
This Jupyter notebook provides statistics on your studying time overall with different charts which visualise what you have studied over the past time frames.

### Functionality
- Gives stats on studying time
- Calculates available study time between 9 AM and 5 PM for the current day and the next day.
- Determines the number of 40-minute study blocks available, considering a 5-minute break between blocks.
- Allocates study blocks to each subject based on their weighting.
- Skips adding blocks during the lunch hour (12:30 PM - 1:30 PM).
- Inserts study blocks and lunch break events into the specified Google Calendar.
- Prints out the study blocks and lunch break events added to the calendar.

## Usage
Use the `study_plan.ipynb` Jupyter Notebook to generate a study plan and add it to your Google Calendar.
To use the `create_study_plan` function, provide it with the following parameters:
- `subjects`: A dictionary containing subjects as keys and their respective weights as values.
- `calendar_id`: (Optional) The ID of the Google Calendar where events will be added. Defaults to "primary".

## Requirements
- Python 3.6 or higher
- Jupyter Notebook
- Google Account with Google Calendar access
- Required Python libraries: google-auth, google-auth-oauthlib, google-auth-httplib2, google-api-python-client, pandas, matplotlib

## Note
Please ensure that you have the necessary permissions to access and modify your Google Calendar.
