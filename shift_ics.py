import re
from datetime import datetime, timedelta

# Read the original ICS file content
with open('timetable.ics', 'r') as f:
    original_content = f.read()

# Regex pattern to match date strings in the format YYYYMMDDTHHMMSS
pattern = r"\d{8}T\d{6}"

# Find all date strings in the file and convert them to datetime objects
date_strings = re.findall(pattern, original_content)
dates = [datetime.strptime(ds, "%Y%m%dT%H%M%S") for ds in date_strings]

# Determine the earliest date among all events
earliest_date = min(dates)
print("Earliest date found in file:", earliest_date)

# Set the target start date for the first lesson (input as YYYYMMDD)
# For example, to start on March 10, 2024:
target_date_str = "20250310"  # Adjust this value as needed
target_date = datetime.strptime(target_date_str, "%Y%m%d")

# Specify whether to start on week A or week B.
# Week A: first week of lessons (no additional shift)
# Week B: second week of lessons (add 7 days)
week_type = "B"  # Set to "A" or "B" as desired

if week_type.upper() == "B":
    target_date = target_date + timedelta(days=7)

# Combine the target date with the time from the earliest event to preserve the original event time
target_dt = datetime.combine(target_date.date(), earliest_date.time())
print("Target date and time for first event:", target_dt)

# Compute the delta (time difference) between the target_dt and the earliest event in the file
delta = target_dt - earliest_date
print("Delta to shift by:", delta)

# Function to shift a date string by the computed delta
def shift_date(match):
    original_date_str = match.group(0)
    dt = datetime.strptime(original_date_str, "%Y%m%dT%H%M%S")
    new_dt = dt + delta
    return new_dt.strftime("%Y%m%dT%H%M%S")

# Replace all date strings in the original ICS content with the shifted dates
shifted_content = re.sub(pattern, shift_date, original_content)

# Write the shifted ICS file
with open('Shifted_Timetable.ics', 'w') as f:
    f.write(shifted_content)

print("Shifted ICS file generated: /mnt/data/Shifted_Timetable.ics")
