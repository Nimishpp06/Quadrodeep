import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Pattern to find duplicate modals - find the second occurrence of labProfessorModal
# Remove everything from the second opening of labProfessorModal until just before manualAttendanceModal

pattern = r'(\</div>\s*\</div>\s*</div>\s*</div>\s*</div>\n\n    <div id="labProfessorModal".*?</div>\s*</div>\s*</div>\s*</div>\s*</div>\n\n    <div id="manualAttendanceModal")'

# This is complex, let me try a different approach - just find all the modals and their positions
matches = list(re.finditer(r'<div id="labProfessorModal"', content))

if len(matches) > 1:
    # Find the end of first modal and start of second
    first_start = matches[0].start()
    second_start = matches[1].start()
    
    # Find the end of first modal (the closing </div></div> for the modal)
    # Look for the pattern that closes a modal: </div>\n    </div>\n\n    before the next div
    after_first = content[first_start:]
    closing_pattern = r'(</div>\n    </div>\n\n    )'
    closing_match = re.search(closing_pattern, after_first)
    
    if closing_match:
        first_end = first_start + closing_match.start() + len(closing_match.group(1))
        # Remove from first_end to second_start
        # But keep the second start position material if it's manualAttendanceModal
        after_second = content[second_start:]
        second_closing = re.search(closing_pattern, after_second)
        if second_closing:
            second_end = second_start + second_closing.start() + len(second_closing.group(1))
            # Remove the second modal
            content = content[:second_start] + content[second_end:]

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed')
