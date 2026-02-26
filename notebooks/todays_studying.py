import datetime
import pytz
from googleapiclient.errors import HttpError
from authenticate import authenticate_google_calendar 

def get_all_studying_hours(service, calendar_id):
    # Get the current local timezone
    local_timezone = datetime.datetime.now(datetime.timezone.utc).astimezone().tzinfo

    # Get today's date in the correct format
    today_start = datetime.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_timezone).isoformat()
    today_end = datetime.datetime.now().replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=local_timezone).isoformat()
    
    # Fetch events happening today
    try:
        events_result = service.events().list(calendarId=calendar_id, timeMin=today_start, timeMax=today_end, singleEvents=True, orderBy='startTime').execute()
    except HttpError as error:
        print(f"An error occurred: {error}")
        return
    
    events = events_result.get('items', [])
    
    if not events:
        print("No events found for today.")
        return
    
    # Calculate total studying hours
    total_hours = 0
    for event in events:
        start = event['start'].get('dateTime', event['start'].get('date'))
        end = event['end'].get('dateTime', event['end'].get('date'))
        start_time = datetime.datetime.fromisoformat(start)
        end_time = datetime.datetime.fromisoformat(end)
        duration = end_time - start_time
        total_hours += duration.total_seconds() / 3600
    
    print(f"Total studying hours scheduled for today: {total_hours:.2f} hours")
    
def get_studying_hours_completed_today(service, calendar_id):
    # Get the current local timezone
    local_timezone = datetime.datetime.now(datetime.timezone.utc).astimezone().tzinfo

    # Get today's date for the start of the day and current time
    today_start = datetime.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_timezone).isoformat()
    now = datetime.datetime.now(tz=local_timezone).isoformat()

    # Fetch events happening today up until now
    try:
        events_result = service.events().list(calendarId=calendar_id, timeMin=today_start, timeMax=now, singleEvents=True, orderBy='startTime').execute()
    except HttpError as error:
        print(f"An error occurred: {error}")
        return

    events = events_result.get('items', [])

    if not events:
        print("No events found for today.")
        return

    # Calculate total studying hours
    total_hours = 0
    for event in events:
        start = event['start'].get('dateTime', event['start'].get('date'))
        end = event['end'].get('dateTime', event['end'].get('date'))
        start_time = datetime.datetime.fromisoformat(start)
        end_time = datetime.datetime.fromisoformat(end)
        # Ensure the event has ended before adding to total hours
        if end_time <= datetime.datetime.now(tz=local_timezone):
            duration = end_time - start_time
            total_hours += duration.total_seconds() / 3600

    print(f"Total studying hours completed today: {total_hours:.2f} hours")
    
if __name__ == '__main__':
    service = authenticate_google_calendar()  # Make sure this function is defined in your script as shown earlier
    get_all_studying_hours(service, '0ca09266015f691eebe0d00c6f3ed7a784713e0160a694b8f7929add00cb1aa1@group.calendar.google.com')  # Replace 'your_calendar_id_here' with your actual studying calendar ID
    get_studying_hours_completed_today(service, '0ca09266015f691eebe0d00c6f3ed7a784713e0160a694b8f7929add00cb1aa1@group.calendar.google.com')  # Replace 'your_calendar_id_here' with your actual studying calendar ID
