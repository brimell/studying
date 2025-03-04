import re
from datetime import datetime, timedelta

# Read the original ICS file content
with open('timetable.ics', 'r') as f:
    original_content = f.read()

# Regex pattern to match date strings in the format YYYYMMDDTHHMMSS
pattern = r"\d{8}T\d{6}"

# Find all date strings in the file
date_strings = re.findall(pattern, original_content)

# Convert them to datetime objects
dates = [datetime.strptime(ds, "%Y%m%dT%H%M%S") for ds in date_strings]

# Determine the earliest date among all events
earliest_date = min(dates)
print("Earliest date found in file:", earliest_date)

# Instead of a fixed delta, take a target start date as input (YYYYMMDD)
# You can replace the following line with: target_date_str = input("Enter target start date (YYYYMMDD): ")
target_date_str = "20250310"  # For example, 10th March 2024
target_date = datetime.strptime(target_date_str, "%Y%m%d")
# Combine the target date with the time from the earliest event
target_dt = datetime.combine(target_date.date(), earliest_date.time())

# Compute the time delta
delta = target_dt - earliest_date
print("Delta to shift by:", delta)

# Function to shift a date string by the computed delta
def shift_date(match):
    original_date_str = match.group(0)
    dt = datetime.strptime(original_date_str, "%Y%m%dT%H%M%S")
    new_dt = dt + delta
    return new_dt.strftime("%Y%m%dT%H%M%S")

# Replace all occurrences of date strings with the shifted dates
shifted_content = re.sub(pattern, shift_date, original_content)

# Write the shifted ICS file
with open('Shifted_Timetable.ics', 'w') as f:
    f.write(shifted_content)

print("Shifted ICS file generated: /mnt/data/Shifted_Timetable.ics")
