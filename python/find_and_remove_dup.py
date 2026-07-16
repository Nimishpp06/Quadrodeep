#!/usr/bin/env python
with open('index.html', 'r') as f:
    lines = f.readlines()

# Find all line numbers containing 'id="labProfessorModal"'
modal_lines = []
for i, line in enumerate(lines):
    if 'id="labProfessorModal"' in line:
        modal_lines.append(i)
        print(f"Found at line {i+1}: {line.strip()}")

# If there are 2 or more, remove the second one and following until we hit manualAttendanceModal
if len(modal_lines) >= 2:
    second_modal_start = modal_lines[1]
    # Find the end of the second modal (look for </div> closing tags and then next modal)
    end_idx = second_modal_start
    for i in range(second_modal_start + 1, len(lines)):
        if 'id="manualAttendanceModal"' in lines[i]:
            # Found the next modal, the second labProfessor modal should end before this
            end_idx = i
            # Go back to find the closing </div>
            for j in range(i-1, second_modal_start, -1):
                if lines[j].strip() == '</div>' and j > second_modal_start + 10:
                    end_idx = j + 1
                    break
            break
    
    # Remove lines from second_modal_start to end_idx
    del lines[second_modal_start:end_idx]
    
    with open('index.html', 'w') as f:
        f.writelines(lines)
    print(f'Removed duplicate from line {second_modal_start+1} to {end_idx}')
else:
    print('No duplicate found')
