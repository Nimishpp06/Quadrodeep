with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find and remove the duplicate modal
# We'll keep only the first instance
parts = content.split('<div id="labProfessorModal" class="modal">')

if len(parts) > 2:
    # Reconstruct with only first modal
    # Find where the first modal ends (before manualAttendanceModal)
    first_modal_section = parts[1]
    # Find the closing </div> for the first modal
    modal_content = first_modal_section[:first_modal_section.find('<div id="manualAttendanceModal"')]
    # Reconstruct
    content = parts[0] + '<div id="labProfessorModal" class="modal">' + modal_content + '<div id="manualAttendanceModal">' + parts[-1].split('<div id="manualAttendanceModal">')[1]
    
    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Duplicate modal removed')
else:
    print('No duplicate found or not enough instances')
