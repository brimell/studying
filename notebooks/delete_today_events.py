import datetime
from googleapiclient.errors import HttpError
from authenticate import authenticate_google_calendar 

def delete_todays_study_plan_events(service, calendar_id='primary'):
    # Get today's date in the correct format
    today_start = datetime.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat() + 'Z'
    today_end = datetime.datetime.now().replace(hour=23, minute=59, second=59, microsecond=999999).isoformat() + 'Z'
    
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
    
    # Delete each event
    for event in events:
        try:
            service.events().delete(calendarId=calendar_id, eventId=event['id']).execute()
            print(f"Deleted event: {event['summary']} scheduled for today.")
        except HttpError as error:
            print(f"An error occurred while deleting event {event['summary']}: {error}")

# Example usage
if __name__ == '__main__':
    service = authenticate_google_calendar()  # Make sure this function is defined in your script as shown earlier
    delete_todays_study_plan_events(service, '0ca09266015f691eebe0d00c6f3ed7a784713e0160a694b8f7929add00cb1aa1@group.calendar.google.com')  # Replace 'your_calendar_id_here' with your actual studying calendar ID
