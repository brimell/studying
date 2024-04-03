# Study Plan Generator

## Functionality
- Gives stats on studying time
- Calculates available study time between 9 AM and 5 PM for the current day and the next day.
- Determines the number of 40-minute study blocks available, considering a 5-minute break between blocks.
- Allocates study blocks to each subject based on their weighting.
- Skips adding blocks during the lunch hour (12:30 PM - 1:30 PM).
- Inserts study blocks and lunch break events into the specified Google Calendar.
- Prints out the study blocks and lunch break events added to the calendar.

## Usage
Use the `studying.ipynb` Jupyter Notebook to generate a study plan and add it to your Google Calendar.
To use the `create_study_plan` function, provide it with the following parameters:
- `subjects`: A dictionary containing subjects as keys and their respective weights as values.
- `calendar_id`: (Optional) The ID of the Google Calendar where events will be added. Defaults to "primary".