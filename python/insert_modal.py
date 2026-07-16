import re

with open('index.html', 'r') as f:
    content = f.read()

modal_html = '''    </div>

    <div id="labProfessorModal" class="modal">
        <div class="modal-content" style="max-width: 700px;">
            <div class="modal-header">
                <h2><span class="material-icons" style="vertical-align: middle;">assignment_ind</span> Manage Lab-Professor Assignments</h2>
                <span class="close-modal" onclick="closeModal('labProfessorModal')">&times;</span>
            </div>
            <div class="form-group" style="padding: 0; border: none;">
                <div style="background:#e8f0fe; padding:16px; border-radius:6px; margin-bottom:20px;">
                    <strong style="color:#1a73e8;">Lab-Professor Mapping</strong>
                    <p style="font-size:0.85rem; margin-top:8px;">Assign professors to manage specific laboratory sessions. Each lab can be managed by multiple professors.</p>
                </div>
                <div>
                    <label style="font-weight:600; color:#555;">Select Lab</label>
                    <select id="profMgmtLabSelect" style="padding:10px; width:100%; border-radius:4px; border:1px solid #ccc; margin-bottom:15px;">
                        <option value="">Select a Lab...</option>
                    </select>
                </div>
                <div>
                    <label style="font-weight:600; color:#555;">Assign Professor</label>
                    <select id="profMgmtProfSelect" style="padding:10px; width:100%; border-radius:4px; border:1px solid #ccc; margin-bottom:10px;">
                        <option value="">Select a Professor...</option>
                    </select>
                    <button onclick="addLabProfessor()" class="portal-btn" style="width:100%; padding:10px;">Add Professor to Lab</button>
                </div>
                <div style="margin-top:20px;">
                    <label style="font-weight:600; color:#555; margin-bottom:10px; display:block;">Current Assignments</label>
                    <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                        <thead>
                            <tr style="background:#f5f5f5; border-bottom:2px solid #ddd;">
                                <th style="padding:10px; text-align:left;">Lab Name</th>
                                <th style="padding:10px; text-align:left;">Professor</th>
                                <th style="padding:10px; text-align:center; width:80px;">Action</th>
                            </tr>
                        </thead>
                        <tbody id="labProfessorBody">
                            <tr><td colspan="3" style="text-align:center; padding:20px; color:#777;">Loading assignments...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>

    <div id="manualAttendanceModal"'''

pattern = r'(    </div>\n\n    <div id="manualAttendanceModal")'
content = re.sub(pattern, modal_html, content)

with open('index.html', 'w') as f:
    f.write(content)

print('Lab-Professor modal inserted successfully')
