import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

js_functions = '''
        // ==========================================
        // LAB-PROFESSOR MANAGEMENT
        // ==========================================
        async function loadLabProfessorModal() {
            // Populate lab dropdown
            const labSelect = document.getElementById('profMgmtLabSelect');
            const profSelect = document.getElementById('profMgmtProfSelect');
            
            try {
                const labRes = await fetch('http://localhost:3000/api/labs');
                const labData = await labRes.json();
                if (labRes.ok && labData.success) {
                    labSelect.innerHTML = '<option value="">Select a Lab...</option>' + 
                        labData.data.map(l => `<option value="${l.id}">${l.labName}</option>`).join('');
                }
            } catch (err) { console.error("Failed to load labs:", err); }

            try {
                const profRes = await fetch('http://localhost:3000/api/professors');
                const profData = await profRes.json();
                if (profRes.ok && profData.success) {
                    profSelect.innerHTML = '<option value="">Select a Professor...</option>' + 
                        profData.data.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
                }
            } catch (err) { console.error("Failed to load professors:", err); }

            await populateLabProfessorTable();
        }

        async function addLabProfessor() {
            const labId = document.getElementById('profMgmtLabSelect').value;
            const profId = document.getElementById('profMgmtProfSelect').value;

            if (!labId || !profId) {
                alert("Please select both a Lab and a Professor.");
                return;
            }

            try {
                const response = await fetch('http://localhost:3000/api/admin/lab-professor', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ labId, professorId: profId })
                });
                const result = await response.json();
                if (result.success) {
                    alert('Professor assigned to lab successfully!');
                    document.getElementById('profMgmtLabSelect').value = '';
                    document.getElementById('profMgmtProfSelect').value = '';
                    await populateLabProfessorTable();
                } else {
                    alert('Failed to assign professor: ' + result.error);
                }
            } catch (error) {
                console.error("Assignment Error:", error);
                alert('Server connection failed.');
            }
        }

        async function removeLabProfessor(labId, profId) {
            if (!confirm('Remove this professor from the lab?')) return;

            try {
                const response = await fetch('http://localhost:3000/api/admin/lab-professor', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ labId, professorId: profId })
                });
                const result = await response.json();
                if (result.success) {
                    alert('Professor removed from lab successfully!');
                    await populateLabProfessorTable();
                } else {
                    alert('Failed to remove professor: ' + result.error);
                }
            } catch (error) {
                console.error("Removal Error:", error);
                alert('Server connection failed.');
            }
        }

        async function populateLabProfessorTable() {
            const tbody = document.getElementById('labProfessorBody');
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:#777;">Loading assignments...</td></tr>';

            try {
                const res = await fetch('http://localhost:3000/api/admin/lab-professor');
                const data = await res.json();
                
                if (data.success && data.data && data.data.length > 0) {
                    tbody.innerHTML = data.data.map(assignment => `
                        <tr>
                            <td>${assignment.labName}</td>
                            <td>${assignment.professorName}</td>
                            <td style="text-align:center;">
                                <button onclick="removeLabProfessor('${assignment.labId}', '${assignment.professorId}')" 
                                        class="portal-btn portal-btn-danger" 
                                        style="padding:4px 8px; font-size:0.75rem;">Remove</button>
                            </td>
                        </tr>
                    `).join('');
                } else {
                    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:#777;">No lab-professor assignments yet.</td></tr>';
                }
            } catch (err) {
                tbody.innerHTML = '<tr><td colspan="3" style="color:red; text-align:center; padding:20px;">Failed to load assignments.</td></tr>';
                console.error("Error loading assignments:", err);
            }
        }
'''

# Find the closing script tag and insert before it
pattern = r'(\s*</script>\s*)$'
if re.search(pattern, content):
    content = re.sub(pattern, js_functions + r'\1', content)
else:
    # If that doesn't work, find the last </script> tag
    last_script_close = content.rfind('</script>')
    if last_script_close != -1:
        content = content[:last_script_close] + js_functions + '\n    ' + content[last_script_close:]

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('JavaScript functions added')
