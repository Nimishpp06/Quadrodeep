import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Add menu item for lab professor management
old_menu = '''            <div class="dropdown-item" onclick="openModal('labAssignModal')"><span class="material-icons">assignment</span> Lab Assignment</div>
            <div class="dropdown-item" onclick="openModal('manualAttendanceModal')"><span class="material-icons">edit_note</span> Global Attendance Logs</div>'''

new_menu = '''            <div class="dropdown-item" onclick="openModal('labAssignModal')"><span class="material-icons">assignment</span> Lab Assignment</div>
            <div class="dropdown-item" onclick="openModal('labProfessorModal')"><span class="material-icons">group_work</span> Manage Lab Professors</div>
            <div class="dropdown-item" onclick="openModal('manualAttendanceModal')"><span class="material-icons">edit_note</span> Global Attendance Logs</div>'''

content = content.replace(old_menu, new_menu)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Menu item added successfully')
