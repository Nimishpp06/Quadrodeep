// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt'); // REQUIRED FOR PASSWORD HASHING
const { checkAndSendLateWarning, checkAndSendProfessorReminders } = require('./services/notificationService');
const mqtt = require('mqtt');
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const mqttClient = mqtt.connect(MQTT_BROKER_URL, { reconnectPeriod: 15000, connectTimeout: 5000 });
let mqttConnected = false;
mqttClient.on('connect', () => { mqttConnected = true; console.log('[MQTT] Connected to broker'); });
mqttClient.on('close', () => { mqttConnected = false; });
mqttClient.on('error', () => { }); // suppress — auto-reconnect handles it

function mqttPublish(topic, payload) {
    if (mqttConnected) {
        mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
// Priority given to service key for backend admin operations
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
    console.error("❌ CRITICAL: Could not find SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

require('./jobs/reminderJob')(supabase); // Start reminder cron job

app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] 🛰️  ${req.method} request received at ${req.url}`);
    next();
});

// ==========================================
// BACKEND SECURITY HELPER FUNCTION
// ==========================================
function isPasswordSecure(pwd) {
    if (!pwd || pwd.length < 8) return false;
    if (pwd.includes(' ') || pwd.includes('.')) return false;
    if (!/[A-Z]/.test(pwd)) return false;
    if (!/[a-z]/.test(pwd)) return false;
    if (!/[0-9]/.test(pwd)) return false;
    if (!/[^A-Za-z0-9\s.]/.test(pwd)) return false;
    return true;
}

function getCurrentDateTime() {
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = days[now.getDay()];
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
    return { currentDay, currentTime, currentDate: localDate };
}

function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + (m || 0);
}



function computeSessionStatus(entry, currentDay, currentTime) {
    const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const sessionDayIndex = dayOrder.indexOf(entry['day of week']);
    const currentDayIndex = dayOrder.indexOf(currentDay);

    if (sessionDayIndex === currentDayIndex) {
        const startMin = timeToMinutes(entry['Start time']);
        const endMin = timeToMinutes(entry['end time']);
        const nowMin = timeToMinutes(currentTime);
        if (nowMin < startMin) return 'upcoming';
        if (nowMin >= startMin && nowMin < endMin) return 'happening';
        return 'over';
    }
    return sessionDayIndex > currentDayIndex ? 'upcoming' : 'over';
}

// ==========================================
// 1. HEALTH CHECK
// ==========================================
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'Online', message: 'Server is running securely.' });
});

// ==========================================
// API ROUTES FOR TIMETABLE
// ==========================================
app.get('/api/timetable', async (req, res) => {
    try {
        const { batchId, professorId, labIds, includeStatus } = req.query;
        let query = supabase.from('timetable').select('*');

        if (batchId) query = query.eq('batch-id', batchId);
        if (professorId) query = query.eq('prof-id', professorId);
        if (labIds) {
            const labIdArray = labIds.split(',').filter(Boolean);
            if (labIdArray.length > 0) query = query.in('lab id', labIdArray);
        }

        const { data, error } = await query;
        if (error) throw error;

        // Optionally compute status for each entry
        let enrichedData = data || [];
        if (includeStatus === 'true') {
            const { currentDay, currentTime } = getCurrentDateTime();
            enrichedData = enrichedData.map(entry => ({
                ...entry,
                status: computeSessionStatus(entry, currentDay, currentTime)
            }));
        }

        return res.status(200).json({ success: true, data: enrichedData });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/timetable', async (req, res) => {
    const { batchId, dayOfWeek, labId, startTime, endTime, mode } = req.body;
    try {
        const { data, error } = await supabase
            .from('timetable')
            .insert([
                {
                    'batch-id': batchId,
                    'day of week': dayOfWeek,
                    'lab id': labId,
                    'Start time': startTime,
                    'end time': endTime,
                    mode: mode || null
                }
            ])
            .select();
        if (error) throw error;
        return res.status(201).json({ success: true, data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/timetable/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase.from('timetable').delete().eq('id', id);
        if (error) throw error;
        return res.status(200).json({ success: true, data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// API ROUTES FOR LABS & NODES
// ==========================================
app.get('/api/labs', async (req, res) => {
    try {
        const { professorId } = req.query;
        const { data: labs, error } = await supabase
            .from('labs')
            .select('id, "lab name", "room number", "esp mode"');
        if (error) throw error;

        const labIds = labs.map((lab) => lab.id).filter(Boolean);
        if (!labIds.length) {
            return res.status(200).json({
                success: true, data: labs.map((lab) => ({
                    id: lab.id,
                    labName: lab['lab name'],
                    roomNumber: lab['room number'],
                    espMode: lab['esp mode'],
                    assignedProfessor: null
                }))
            });
        }

        const { data: assignments, error: assignmentError } = await supabase
            .from('professors-labs')
            .select('id, "prof-id"')
            .in('id', labIds);
        if (assignmentError) throw assignmentError;

        const professorIds = [...new Set(assignments.map((row) => row['prof-id']).filter(Boolean))];
        const { data: professors, error: professorError } = professorIds.length
            ? await supabase.from('users').select('id, name, email').in('id', professorIds)
            : { data: [], error: null };
        if (professorError) throw professorError;

        const professorMap = (professors || []).reduce((acc, professor) => {
            acc[professor.id] = professor;
            return acc;
        }, {});

        const assignmentMap = assignments.reduce((acc, assignment) => {
            acc[assignment.id] = professorMap[assignment['prof-id']] || null;
            return acc;
        }, {});

        let filteredLabs = labs;
        if (professorId) {
            const { data: professorAssignments } = await supabase
                .from('professors-labs')
                .select('id')
                .eq('prof-id', professorId);
            const assignedLabIds = new Set(professorAssignments?.map(a => a.id) || []);
            filteredLabs = labs.filter(lab => assignedLabIds.has(lab.id));
        }

        const data = filteredLabs.map((lab) => ({
            id: lab.id,
            labName: lab['lab name'],
            roomNumber: lab['room number'],
            espMode: lab['esp mode'],
            assignedProfessor: assignmentMap[lab.id]
                ? {
                    professorId: assignmentMap[lab.id].id,
                    professorName: assignmentMap[lab.id].name,
                    professorEmail: assignmentMap[lab.id].email
                }
                : null
        }));

        return res.status(200).json({ success: true, data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/labs', async (req, res) => {
    const { labId, labName, roomNumber } = req.body;
    try {
        const { data, error } = await supabase
            .from('labs')
            .insert([
                {
                    id: labId,
                    'lab name': labName,
                    'room number': roomNumber || null,
                    'esp mode': null
                }
            ])
            .select();
        if (error) throw error;
        return res.status(201).json({ success: true, data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// ADMIN: LAB-PROFESSOR MAPPINGS
// ==========================================
app.get('/api/admin/lab-professors', async (req, res) => {
    try {
        const { data: mappings, error } = await supabase
            .from('professors-labs')
            .select('id, "prof-id"');
        if (error) throw error;

        const labIds = [...new Set(mappings.map((row) => row.id).filter(Boolean))];
        const professorIds = [...new Set(mappings.map((row) => row['prof-id']).filter(Boolean))];

        const { data: labs, error: labError } = labIds.length
            ? await supabase.from('labs').select('id, "lab name"').in('id', labIds)
            : { data: [], error: null };
        if (labError) throw labError;

        const { data: professors, error: professorError } = professorIds.length
            ? await supabase.from('users').select('id, name, email').in('id', professorIds)
            : { data: [], error: null };
        if (professorError) throw professorError;

        const labMap = (labs || []).reduce((acc, lab) => {
            acc[lab.id] = lab;
            return acc;
        }, {});
        const professorMap = (professors || []).reduce((acc, professor) => {
            acc[professor.id] = professor;
            return acc;
        }, {});

        const data = mappings.map((mapping) => ({
            labId: mapping.id,
            labName: labMap[mapping.id]?.['lab name'] || null,
            professorId: mapping['prof-id'],
            professorName: professorMap[mapping['prof-id']]?.name || null,
            professorEmail: professorMap[mapping['prof-id']]?.email || null
        }));

        return res.status(200).json({ success: true, data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/lab-professors', async (req, res) => {
    const { labId, professorId } = req.body;
    try {
        const { data, error } = await supabase
            .from('professors-labs')
            .upsert([{ id: labId, 'prof-id': professorId }])
            .select();
        if (error) throw error;
        return res.status(201).json({ success: true, data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/admin/lab-professors/:labId/:professorId', async (req, res) => {
    const { labId, professorId } = req.params;
    try {
        const { data, error } = await supabase
            .from('professors-labs')
            .delete()
            .eq('id', labId)
            .eq('prof-id', professorId);
        if (error) throw error;
        return res.status(200).json({ success: true, data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// API ROUTES FOR BATCHES & PROFESSORS
// ==========================================
app.get('/api/batches', async (req, res) => {
    try {
        const { data, error } = await supabase.from('batches').select('id, batches');
        if (error) throw error;
        return res.status(200).json({ success: true, data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// GET /api/professor/me - Current professor's assigned labs
// ==========================================
app.get('/api/professor/me', async (req, res) => {
    try {
        const professorId = req.query.professorId;
        if (!professorId) {
            return res.status(400).json({ success: false, error: 'professorId required' });
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, name, email, role')
            .eq('id', professorId)
            .eq('role', 'professor')
            .single();
        if (userError || !user) {
            return res.status(403).json({ success: false, error: 'Not a professor' });
        }

        const { data: assignments, error: assignError } = await supabase
            .from('professors-labs')
            .select('id')
            .eq('prof-id', professorId);
        if (assignError) throw assignError;

        const labIds = [...new Set(assignments.map(a => a.id).filter(Boolean))];
        const { data: labs, error: labError } = labIds.length
            ? await supabase.from('labs').select('id, "lab name", "room number", "esp mode"').in('id', labIds)
            : { data: [], error: null };
        if (labError) throw labError;

        return res.status(200).json({
            success: true,
            data: {
                professor: { id: user.id, name: user.name, email: user.email },
                assignedLabs: (labs || []).map(l => ({
                    id: l.id,
                    labName: l['lab name'],
                    roomNumber: l['room number'],
                    espMode: l['esp mode']
                }))
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// GET /api/professor/upcoming-sessions - Sessions near current time
// ==========================================
app.get('/api/professor/upcoming-sessions', async (req, res) => {
    try {
        const professorId = req.query.professorId;
        if (!professorId) {
            return res.status(400).json({ success: false, error: 'professorId required' });
        }

        // Get professor's assigned labs
        const { data: assignments } = await supabase
            .from('professors-labs')
            .select('id')
            .eq('prof-id', professorId);
        const labIds = [...new Set(assignments?.map(a => a.id).filter(Boolean) || [])];
        if (!labIds.length) {
            return res.status(200).json({ success: true, data: [] });
        }

        // Check vacation mode
        const vacation = await getVacationStatus();
        if (vacation.active) {
            return res.status(200).json({ success: true, data: [], vacation: true });
        }

        const { currentDay, currentTime } = getCurrentDateTime();
        const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const currentDayIndex = dayOrder.indexOf(currentDay);

        // Fetch timetable for assigned labs
        const { data: sessions, error } = await supabase
            .from('timetable')
            .select('id, "lab id", "batch-id", "day of week", "Start time", "end time", mode')
            .in('lab id', labIds);
        if (error) throw error;

        // Get lab names
        const { data: labs } = await supabase
            .from('labs')
            .select('id, "lab name"')
            .in('id', labIds);
        const labNameMap = (labs || []).reduce((acc, l) => { acc[l.id] = l['lab name']; return acc; }, {});

        // Get batch names
        const batchIds = [...new Set((sessions || []).map(s => s['batch-id']).filter(Boolean))];
        const { data: batches } = batchIds.length
            ? await supabase.from('batches').select('id, batches').in('id', batchIds)
            : { data: [] };
        const batchNameMap = (batches || []).reduce((acc, b) => { acc[b.id] = b.batches; return acc; }, {});

        // Enrich with status and time diff
        const enriched = (sessions || []).map(session => {
            const sessionDay = session['day of week'];
            const sessionDayIndex = dayOrder.indexOf(sessionDay);
            const startTime = session['Start time'];
            const endTime = session['end time'];

            let status = 'upcoming';
            let timeUntilStart = null;
            let timeUntilEnd = null;

            if (sessionDayIndex === currentDayIndex) {
                const startMinutes = timeToMinutes(startTime);
                const endMinutes = timeToMinutes(endTime);
                const currentMinutes = timeToMinutes(currentTime);

                if (currentMinutes < startMinutes) {
                    status = 'upcoming';
                    timeUntilStart = startMinutes - currentMinutes;
                } else if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
                    status = 'happening';
                    timeUntilEnd = endMinutes - currentMinutes;
                } else {
                    status = 'over';
                }
            } else if (sessionDayIndex > currentDayIndex) {
                status = 'upcoming';
                const daysDiff = sessionDayIndex - currentDayIndex;
                timeUntilStart = daysDiff * 1440 + timeToMinutes(startTime) - timeToMinutes(currentTime);
            } else {
                status = 'over';
            }

            return {
                timetableId: session.id,
                labId: session['lab id'],
                labName: labNameMap[session['lab id']] || session['lab id'],
                batchId: session['batch-id'],
                batchName: batchNameMap[session['batch-id']] || session['batch-id'],
                dayOfWeek: sessionDay,
                startTime,
                endTime,
                mode: session.mode,
                status,
                timeUntilStart,
                timeUntilEnd,
                sortKey: status === 'happening' ? 0 : status === 'upcoming' ? 1 : 2
            };
        });

        // Sort: happening first, then upcoming (nearest first), then over
        enriched.sort((a, b) => {
            if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
            if (a.status === 'upcoming' && b.status === 'upcoming') {
                return (a.timeUntilStart || 0) - (b.timeUntilStart || 0);
            }
            return 0;
        });

        return res.status(200).json({ success: true, data: enriched });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/professors', async (req, res) => {
    try {
        const { data: professors, error } = await supabase
            .from('users')
            .select('id, name, email')
            .eq('role', 'professor');
        if (error) throw error;

        const professorIds = professors.map((prof) => prof.id).filter(Boolean);
        const { data: assignments, error: assignError } = professorIds.length
            ? await supabase.from('professors-labs').select('id, "prof-id"').in('"prof-id"', professorIds)
            : { data: [], error: null };
        if (assignError) throw assignError;

        const labIds = [...new Set(assignments.map((assignment) => assignment.id).filter(Boolean))];
        const { data: labs, error: labError } = labIds.length
            ? await supabase.from('labs').select('id, "lab name"').in('id', labIds)
            : { data: [], error: null };
        if (labError) throw labError;

        const labMap = (labs || []).reduce((acc, lab) => {
            acc[lab.id] = lab;
            return acc;
        }, {});

        const assignedLabs = (assignments || []).reduce((acc, assignment) => {
            const profId = assignment['prof-id'];
            if (!acc[profId]) acc[profId] = [];
            acc[profId].push({
                labId: assignment.id,
                labName: labMap[assignment.id]?.['lab name'] || null
            });
            return acc;
        }, {});

        const data = professors.map((professor) => ({
            id: professor.id,
            name: professor.name,
            email: professor.email,
            assigned_labs: assignedLabs[professor.id] || []
        }));

        return res.status(200).json({ success: true, data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// GET /api/users - List all users (optionally filtered by role)
// ==========================================
app.get('/api/users', async (req, res) => {
    try {
        const { role } = req.query;
        let query = supabase.from('users').select('id, name, email, role, rfid, biometric');
        if (role) query = query.eq('role', role);
        query = query.order('name', { ascending: true });
        const { data, error } = await query;
        if (error) throw error;
        return res.status(200).json({ success: true, data: data || [] });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// API ROUTES FOR USERS (ENROLLMENT & AUTH)
// ==================================
app.post('/api/users', async (req, res) => {
    const { name, email, password, batchId, rfid, biometric, role } = req.body;

    if (!role || !['admin', 'professor', 'student'].includes(role)) {
        return res.status(400).json({ success: false, error: 'A valid role is required.' });
    }

    if (!isPasswordSecure(password)) {
        return res.status(400).json({ success: false, error: 'Password does not meet the strict security requirements.' });
    }

    try {
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const { data: userData, error: userError } = await supabase
            .from('users')
            .insert([
                {
                    name,
                    email,
                    password_hash: passwordHash,
                    rfid: rfid || null,
                    biometric: biometric || null,
                    role
                }
            ])
            .select();

        if (userError) throw userError;
        const newUser = userData[0];

        if (role === 'student' && batchId) {
            const { error: batchError } = await supabase
                .from('batches link')
                .insert([{ id: newUser.id, 'batch id': batchId }]);

            if (batchError) console.error('Enrollment Mapping Error:', batchError);
        }

        console.log(`✨ New ${role} securely mapped to database!`);
        return res.status(201).json({ success: true, data: newUser });
    } catch (err) {
        console.error('❌ Database Error enrolling user:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/users/password', async (req, res) => {
    const { email, currentPassword, newPassword } = req.body;

    if (!isPasswordSecure(newPassword)) {
        return res.status(400).json({ success: false, error: 'New password does not meet the strict security requirements.' });
    }

    try {
        const { data: user, error: fetchError } = await supabase
            .from('users')
            .select('id, password_hash')
            .eq('email', email)
            .single();

        if (fetchError || !user) throw new Error('User not found.');

        const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isMatch) return res.status(401).json({ success: false, error: 'Incorrect current password.' });

        const newHash = await bcrypt.hash(newPassword, 10);
        const { data, error: updateError } = await supabase
            .from('users')
            .update({ password_hash: newHash })
            .eq('email', email)
            .select();

        if (updateError) throw updateError;
        console.log(`🔒 Password successfully updated for ${email}`);
        return res.status(200).json({ success: true, message: 'Password updated.' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('id, name, email, role, biometric, password_hash')
            .eq('email', email);

        if (error) {
            console.error('❌ Supabase Select Error:', error.message);
            return res.status(500).json({ success: false, error: error.message });
        }

        if (!users || users.length === 0) {
            return res.status(401).json({ success: false, error: 'Account not found.' });
        }

        const user = users[0];
        let match = false;
        if (user.password_hash && (user.password_hash.startsWith('$2b$') || user.password_hash.startsWith('$2a$'))) {
            match = await bcrypt.compare(password, user.password_hash);
        } else {
            match = password === user.password_hash;
        }

        if (!match) return res.status(401).json({ success: false, error: 'Invalid password.' });

        let batchId = null;
        if (user.role === 'student') {
            const { data: batchData, error: batchError } = await supabase
                .from('batches link')
                .select('"batch id"')
                .eq('id', user.id);

            if (!batchError && batchData && batchData.length > 0) {
                batchId = batchData[0]['batch id'];
            }
        }

        const safeUser = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            batchId,
            biometric: user.biometric
        };

        return res.status(200).json({ success: true, user: safeUser });
    } catch (err) {
        console.error('❌ Login Server Exception:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// PATCH /api/users/:id/rfid — Update RFID for existing user
// ==========================================
app.patch('/api/users/:id/rfid', async (req, res) => {
    const { id } = req.params;
    const { rfid } = req.body;
    if (!rfid) return res.status(400).json({ success: false, error: 'rfid required' });

    try {
        const { data, error } = await supabase
            .from('users')
            .update({ rfid })
            .eq('id', id)
            .select('id, name, email, role, rfid, biometric');
        if (error) throw error;
        if (!data || data.length === 0) return res.status(404).json({ success: false, error: 'User not found' });
        return res.status(200).json({ success: true, data: data[0] });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// PATCH /api/users/:id/biometric — Update fingerprint template for existing user
// ==========================================
app.patch('/api/users/:id/biometric', async (req, res) => {
    const { id } = req.params;
    const { biometric } = req.body;
    if (!biometric) return res.status(400).json({ success: false, error: 'biometric required' });

    try {
        const { data, error } = await supabase
            .from('users')
            .update({ biometric })
            .eq('id', id)
            .select('id, name, email, role, rfid, biometric');
        if (error) throw error;
        if (!data || data.length === 0) return res.status(404).json({ success: false, error: 'User not found' });
        return res.status(200).json({ success: true, data: data[0] });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// API ROUTES FOR ATTENDANCE & ESP SCANS
// ==================================
app.get('/api/attendance', async (req, res) => {
    try {
        const { data: attendanceRows, error } = await supabase
            .from('attendance')
            .select('id, "student-id", "timetable-id", date, status, "marked by"')
            .order('date', { ascending: false });
        if (error) throw error;

        const studentIds = [...new Set(attendanceRows.map((row) => row['student-id']).filter(Boolean))];
        const timetableIds = [...new Set(attendanceRows.map((row) => row['timetable-id']).filter(Boolean))];

        const { data: students, error: studentError } = studentIds.length
            ? await supabase.from('users').select('id, name').in('id', studentIds)
            : { data: [], error: null };
        if (studentError) throw studentError;

        const { data: timetables, error: timetableError } = timetableIds.length
            ? await supabase.from('timetable').select('id, "lab id"').in('id', timetableIds)
            : { data: [], error: null };
        if (timetableError) throw timetableError;

        const labIds = [...new Set((timetables || []).map((row) => row['lab id']).filter(Boolean))];
        const { data: labs, error: labError } = labIds.length
            ? await supabase.from('labs').select('id, "lab name"').in('id', labIds)
            : { data: [], error: null };
        if (labError) throw labError;

        const studentMap = (students || []).reduce((acc, student) => {
            acc[student.id] = student.name;
            return acc;
        }, {});
        const timetableMap = (timetables || []).reduce((acc, tt) => {
            acc[tt.id] = tt['lab id'];
            return acc;
        }, {});
        const labMap = (labs || []).reduce((acc, lab) => {
            acc[lab.id] = lab['lab name'];
            return acc;
        }, {});

        const data = attendanceRows.map((row) => ({
            id: row.id,
            studentId: row['student-id'],
            studentName: studentMap[row['student-id']] || null,
            timetableId: row['timetable-id'],
            labName: labMap[timetableMap[row['timetable-id']]] || null,
            date: row.date,
            status: row.status,
            markedBy: row['marked by']
        }));

        return res.status(200).json({ success: true, data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/attendance/scan', async (req, res) => {
    const { labId, rfid, fingerId, biometric, timestamp } = req.body;
    // ESP sends NTP-synced timestamp; fall back to server time
    const scannedAt = timestamp ? new Date(timestamp) : new Date();
    const scannedDay = scannedAt.toLocaleDateString('en-US', { weekday: 'long' });
    const scannedTime = `${String(scannedAt.getHours()).padStart(2, '0')}:${String(scannedAt.getMinutes()).padStart(2, '0')}`;
    const scannedDate = new Date(scannedAt.getTime() - scannedAt.getTimezoneOffset() * 60000).toISOString().split('T')[0];

    console.log(`📡 HARDWARE SCAN RECEIVED -> Lab: ${labId} | RFID: ${rfid} | fingerId: ${fingerId} | Biometric: ${biometric}`);

    if (!rfid && !fingerId && !biometric) {
        return res.status(400).json({ success: false, error: 'Provide rfid, fingerId, or biometric.' });
    }

    try {
        const vacation = await getVacationStatus();
        if (vacation.active) return res.status(200).json({ success: false, error: 'Vacation mode active' });

        let user = null;

        if (fingerId) {
            // Must filter by session_id
            const { data: device } = await supabase.from('devices').select('current_session_id').eq('id', labId).single();
            const sessionId = device?.current_session_id;
            if (!sessionId) return res.status(400).json({ success: false, error: 'No active session on device' });

            // Look up student via session_biometric_cache finger_id slot
            const { data: cacheEntry } = await supabase
                .from('session_biometric_cache')
                .select('student_id')
                .eq('session_id', sessionId)
                .eq('finger_id', fingerId)
                .single();

            if (cacheEntry?.student_id) {
                const { data: u } = await supabase
                    .from('users')
                    .select('id, name')
                    .eq('id', cacheEntry.student_id)
                    .single();
                user = u;
            }
        } else {
            let userQuery = supabase.from('users').select('id, name');
            if (rfid) userQuery = userQuery.eq('rfid', rfid);
            else if (biometric) userQuery = userQuery.eq('biometric', biometric);
            const { data: u } = await userQuery.single();
            user = u;
        }

        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found.' });
        }

        const { data: timetable, error: timetableError } = await supabase
            .from('timetable')
            .select('id, "lab id", "batch-id", "day of week", "Start time", "end time"')
            .eq('lab id', labId)
            .filter('day of week', 'eq', scannedDay)
            .lte('Start time', scannedTime)
            .gte('end time', scannedTime)
            .limit(1)
            .single();

        if (timetableError || !timetable) {
            return res.status(404).json({ success: false, error: 'No active timetable found for this lab.' });
        }

        // Late detection: grace period of 15 minutes after start time
        const startMinutes = timeToMinutes(timetable['Start time']);
        const scanMinutes = timeToMinutes(scannedTime);
        const isLate = scanMinutes > startMinutes + 15;

        const markedBy = rfid ? 'RFID' : fingerId ? 'Fingerprint' : 'Biometric';
        const attendanceStatus = isLate ? 'Late' : 'Present';

        const { data: attendanceData, error: attendanceError } = await supabase
            .from('attendance')
            .insert([
                {
                    'student-id': user.id,
                    'timetable-id': timetable.id,
                    date: scannedDate,
                    status: attendanceStatus,
                    'marked by': markedBy
                }
            ])
            .select();

        if (attendanceError) throw attendanceError;

        if (isLate) {
            // Non-blocking call
            checkAndSendLateWarning(supabase, user.id, timetable.id, scannedAt).catch(console.error);
        }

        console.log(`✅ Attendance logged for: ${user.name} (${attendanceStatus})`);
        return res.status(200).json({ success: true, message: 'Attendance logged', student: user.name, status: attendanceStatus, attendance: attendanceData[0] });
    } catch (err) {
        console.error('❌ Scan Processing Error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/attendance/:id', async (req, res) => {
    const { id } = req.params;
    const { status, markedBy } = req.body;
    const updatePayload = {};
    if (status !== undefined) updatePayload.status = status;
    if (markedBy !== undefined) updatePayload['marked by'] = markedBy;

    try {
        const { data, error } = await supabase
            .from('attendance')
            .update(updatePayload)
            .eq('id', id)
            .select();
        if (error) throw error;
        return res.status(200).json({ success: true, data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/labs/mode', async (req, res) => {
    const { labId, mode } = req.body;
    try {
        await Promise.all([
            supabase.from('labs').update({ 'esp mode': mode }).eq('id', labId),
            supabase.from('devices').update({ current_mode: mode }).eq('id', labId)
        ]);
        return res.status(200).json({ success: true, data: { mode } });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// PROFESSOR SESSION ENDPOINTS
// ==========================================
app.get('/api/professor/active-sessions', async (req, res) => {
    const professorId = req.query.professorId;
    if (!professorId) {
        return res.status(400).json({ success: false, error: 'professorId query parameter is required.' });
    }

    try {
        const { data: labMappings, error: mappingError } = await supabase
            .from('professors-labs')
            .select('id')
            .eq('prof-id', professorId);
        if (mappingError) throw mappingError;

        const labIds = labMappings.map((map) => map.id).filter(Boolean);
        if (!labIds.length) {
            return res.status(200).json({ success: true, data: [] });
        }

        const { currentDay, currentTime } = getCurrentDateTime();
        const { data: sessions, error: sessionError } = await supabase
            .from('timetable')
            .select('id, "lab id", "batch-id", "day of week", "Start time", "end time"')
            .in('lab id', labIds)
            .filter('day of week', 'eq', currentDay)
            .lte('Start time', currentTime)
            .gte('end time', currentTime);
        if (sessionError) throw sessionError;

        const batchIds = [...new Set(sessions.map((session) => session['batch-id']).filter(Boolean))];
        const { data: batchLinks, error: batchLinkError } = batchIds.length
            ? await supabase.from('batches link').select('"batch id"').in('batch id', batchIds)
            : { data: [], error: null };
        if (batchLinkError) throw batchLinkError;

        const studentCountMap = (batchLinks || []).reduce((acc, row) => {
            const batchId = row['batch id'];
            acc[batchId] = (acc[batchId] || 0) + 1;
            return acc;
        }, {});

        const { data: labs, error: labsError } = await supabase
            .from('labs')
            .select('id, "lab name"')
            .in('id', labIds);
        if (labsError) throw labsError;

        const labNameMap = (labs || []).reduce((acc, lab) => {
            acc[lab.id] = lab['lab name'];
            return acc;
        }, {});

        const data = sessions.map((session) => ({
            timetableId: session.id,
            labId: session['lab id'],
            labName: labNameMap[session['lab id']] || null,
            batchId: session['batch-id'],
            dayOfWeek: session['day of week'],
            startTime: session['Start time'],
            endTime: session['end time'],
            studentCount: studentCountMap[session['batch-id']] || 0
        }));

        return res.status(200).json({ success: true, data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/professor/session/initialize', async (req, res) => {
    const { timetableId, professorId } = req.body;
    if (!timetableId || !professorId) {
        return res.status(400).json({ success: false, error: 'timetableId and professorId are required.' });
    }

    try {
        const { data: timetable, error: timetableError } = await supabase
            .from('timetable')
            .select('id, "lab id", "batch-id", "prof-id", mode, "Start time", "end time"')
            .eq('id', timetableId)
            .single();
        if (timetableError || !timetable) {
            return res.status(404).json({ success: false, error: 'Timetable entry not found.' });
        }

        const { data: batchLinks, error: batchLinkError } = await supabase
            .from('batches link')
            .select('id')
            .eq('batch id', timetable['batch-id']);
        if (batchLinkError) throw batchLinkError;

        const studentIds = batchLinks.map((link) => link.id).filter(Boolean);
        const { data: students, error: studentError } = studentIds.length
            ? await supabase.from('users').select('id, name, rfid, biometric').in('id', studentIds)
            : { data: [], error: null };
        if (studentError) throw studentError;

        // Use device's current_mode from ESP Mode modal if set, else timetable mode
        const { data: deviceMode } = await supabase
            .from('devices')
            .select('current_mode')
            .eq('id', timetable['lab id'])
            .maybeSingle();
        const effectiveMode = (deviceMode?.current_mode) || timetable.mode || 'attendance_either';

        // Set device to session_active
        await supabase
            .from('devices')
            .update({ current_session_id: timetableId, status: 'session_active' })
            .eq('id', timetable['lab id']);

        // Compute Unix timestamps for session duration
        const todayStr = new Date().toISOString().split('T')[0];
        const startUnix = Math.floor(new Date(`${todayStr}T${timetable['Start time']}:00`).getTime() / 1000);
        const endUnix = Math.floor(new Date(`${todayStr}T${timetable['end time']}:00`).getTime() / 1000);

        // Publish START command via MQTT
        mqttPublish(`lab/${timetable['lab id']}/control`, {
            command: 'START',
            session_id: timetableId,
            mode: effectiveMode,
            start_time: startUnix,
            end_time: endUnix
        });

        // Insert load_session command as HTTP fallback
        await supabase
            .from('enrollment_commands')
            .insert([{
                lab_id: timetable['lab id'],
                type: 'load_session',
                target_user_id: timetableId,
                result_value: effectiveMode,
                expires_at: new Date(Date.now() + 60 * 1000).toISOString()
            }])
            .select()
            .maybeSingle();

        return res.status(200).json({
            success: true,
            data: {
                sessionId: timetableId,
                labId: timetable['lab id'],
                batchId: timetable['batch-id'],
                mode: effectiveMode,
                students
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/professor/session/end', async (req, res) => {
    const { labId } = req.body;
    if (!labId) return res.status(400).json({ success: false, error: 'labId required' });

    try {
        await supabase.from('devices').update({
            current_session_id: null,
            status: 'idle'
        }).eq('id', labId);

        mqttPublish(`lab/${labId}/control`, { command: 'END' });

        await supabase
            .from('enrollment_commands')
            .insert([{
                lab_id: labId,
                type: 'end_session',
                expires_at: new Date(Date.now() + 60 * 1000).toISOString()
            }])
            .select()
            .maybeSingle();

        return res.status(200).json({ success: true, message: 'Session ended' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// ADMIN: ASSIGN LAB ENDPOINT
// ==========================================
app.post('/api/admin/assign-lab', async (req, res) => {
    const { labId, professorId, batchId, dayOfWeek, startTime, endTime, labName, mode } = req.body;
    if (!labId || !professorId || !batchId || !dayOfWeek || !startTime || !endTime) {
        return res.status(400).json({ success: false, error: 'Missing required fields for lab assignment.' });
    }

    try {
        if (labName) {
            const { error: labError } = await supabase
                .from('labs')
                .update({ 'lab name': labName })
                .eq('id', labId);
            if (labError) throw labError;
        }

        const { error: mappingError } = await supabase
            .from('professors-labs')
            .upsert([{ id: labId, 'prof-id': professorId }]);
        if (mappingError) throw mappingError;

        const { data, error: timetableError } = await supabase
            .from('timetable')
            .upsert([
                {
                    'lab id': labId,
                    'prof-id': professorId,
                    'batch-id': batchId,
                    'day of week': dayOfWeek,
                    'Start time': startTime,
                    'end time': endTime,
                    mode: mode || null
                }
            ])
            .select();
        if (timetableError) throw timetableError;

        return res.status(200).json({ success: true, message: 'Lab assigned successfully!', data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// VACATION MODE ENDPOINTS
// ==========================================

async function getVacationStatus() {
    try {
        const { data, error } = await supabase
            .from('vacation_settings')
            .select('active, start_date, end_date, reason')
            .eq('id', 1)
            .single();

        if (error || !data || !data.active) return { active: false };

        const now = new Date();
        const start = data.start_date ? new Date(data.start_date) : null;
        const end = data.end_date ? new Date(data.end_date) : null;

        if (start && now < start) return { active: false };
        if (end && now > end) {
            await supabase.from('vacation_settings').update({ active: false }).eq('id', 1);
            return { active: false };
        }

        return { active: true, startDate: data.start_date, endDate: data.end_date, reason: data.reason };
    } catch (err) {
        console.error('Vacation fetch error:', err);
        return { active: false };
    }
}

app.get('/api/admin/vacation-status', async (req, res) => {
    try {
        const status = await getVacationStatus();
        res.status(200).json({ success: true, data: status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/vacation', async (req, res) => {
    try {
        const { startDate, endDate, reason } = req.body;
        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, error: 'startDate and endDate required' });
        }

        const payload = { active: true, start_date: startDate, end_date: endDate, reason: reason || '' };
        await supabase.from('vacation_settings').upsert([{ id: 1, ...payload }]);

        res.status(200).json({ success: true, data: payload });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/admin/vacation', async (req, res) => {
    try {
        await supabase.from('vacation_settings').update({ active: false, start_date: null, end_date: null, reason: '' }).eq('id', 1);
        res.status(200).json({ success: true, message: 'Vacation mode ended' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// ESP32 DEVICE MANAGEMENT ENDPOINTS
// ==========================================

// 3.1 POST /api/device/register — ESP boot registration
app.post('/api/device/register', async (req, res) => {
    const { labId, firmwareVersion } = req.body;
    if (!labId) return res.status(400).json({ success: false, error: 'labId required' });
    if (!/^[A-Z0-9_]+$/.test(labId)) {
        return res.status(400).json({ success: false, error: 'Invalid labId format' });
    }

    try {
        const { data, error } = await supabase
            .from('devices')
            .upsert([{
                id: labId,
                name: labId,
                lab_id: labId,
                firmware_version: firmwareVersion,
                status: 'online',
                last_seen: new Date().toISOString()
            }], { onConflict: 'id' })
            .select();

        if (error) throw error;

        // Check for active session
        const now = new Date();
        const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        const { data: session } = await supabase
            .from('timetable')
            .select('id, "batch-id", "lab id", "day of week", "Start time", "end time", mode')
            .eq('lab id', labId)
            .filter('day of week', 'eq', currentDay)
            .lte('Start time', currentTime)
            .gte('end time', currentTime)
            .limit(1)
            .single();

        return res.status(200).json({
            success: true,
            data: {
                device: data[0],
                activeSession: session ? {
                    sessionId: session.id,
                    batchId: session['batch-id'],
                    mode: session.mode || 'attendance_either'
                } : null
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 3.2 GET /api/device/command — ESP polls for pending commands
app.get('/api/device/command', async (req, res) => {
    const { labId } = req.query;
    if (!labId) return res.status(400).json({ success: false, error: 'labId required' });
    if (!/^[A-Z0-9_]+$/.test(labId)) {
        return res.status(400).json({ success: false, error: 'Invalid labId format' });
    }

    try {
        // Debug: Log what we're querying
        console.log(`[CMD POLL] Querying for lab_id: "${labId}"`);

        // More robust query - case insensitive, handle status variations
        const { data, error } = await supabase
            .from('enrollment_commands')
            .select('*')
            .ilike('lab_id', labId.trim())  // case-insensitive
            .in('status', ['pending', 'sent'])  // accept both pending and sent
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: true })
            .limit(1)
            .single();

        if (error && error.code !== 'PGRST116') throw error;

        // Debug: log what we found
        if (data) {
            console.log(`[CMD POLL] Found command:`, {
                id: data.id,
                type: data.type,
                lab_id: data.lab_id,
                status: data.status,
                expires_at: data.expires_at
            });
        } else {
            console.log(`[CMD POLL] No command found for lab_id: "${labId}"`);
            // Debug: check what commands exist for this lab
            const { data: debugData } = await supabase
                .from('enrollment_commands')
                .select('id, lab_id, status, expires_at, created_at')
                .ilike('lab_id', labId.trim())
                .order('created_at', { ascending: false })
                .limit(5);
            console.log('[DEBUG] Recent commands for lab:', debugData);
        }

        if (error && error.code !== 'PGRST116') throw error;
        if (!data) return res.status(200).json({ success: true, data: null });

        // Mark as sent
        await supabase
            .from('enrollment_commands')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('id', data.id);

        return res.status(200).json({ success: true, data });
    } catch (err) {
        console.error('[CMD POLL ERROR]', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 3.3 POST /api/device/enrollment/rfid — ESP reports captured RFID or timeout
app.post('/api/device/enrollment/rfid', async (req, res) => {
    const { labId, rfid, commandId, status } = req.body;
    if (!labId || !commandId) return res.status(400).json({ success: false, error: 'Missing fields' });
    if (!/^[A-Z0-9_]+$/.test(labId)) {
        return res.status(400).json({ success: false, error: 'Invalid labId format' });
    }

    try {
        // Handle timeout from ESP32 (no card tapped within 10s)
        if (status === 'timeout') {
            const { error: updateError } = await supabase
                .from('enrollment_commands')
                .update({
                    status: 'timeout',
                    completed_at: new Date().toISOString()
                })
                .eq('id', commandId);
            if (updateError) throw updateError;
            console.log(`[ENROLLMENT] Command ${commandId} timed out (no card tapped)`);
            return res.status(200).json({ success: true, data: { status: 'timeout' } });
        }

        // Normal enrollment: rfid is required
        if (!rfid) return res.status(400).json({ success: false, error: 'Missing rfid' });

        const { error: updateError } = await supabase
            .from('enrollment_commands')
            .update({
                status: 'completed',
                result_value: rfid,
                completed_at: new Date().toISOString()
            })
            .eq('id', commandId);

        if (updateError) throw updateError;

        return res.status(200).json({ success: true, data: { rfid } });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 3.4 POST /api/device/enrollment/fingerprint — ESP reports captured fingerprint template
app.post('/api/device/enrollment/fingerprint', async (req, res) => {
    const { labId, fingerId, templateBase64, commandId } = req.body;
    if (!labId || !fingerId || !commandId) return res.status(400).json({ success: false, error: 'Missing fields' });
    if (!/^[A-Z0-9_]+$/.test(labId)) {
        return res.status(400).json({ success: false, error: 'Invalid labId format' });
    }
    // ESP must send templateBase64 as base64-encoded string of raw RS307 template bytes (512 bytes typical)
    // Arduino: base64::encode(templateBuffer, templateSize)

    try {
        // Look up target user on the command
        const { data: cmd } = await supabase
            .from('enrollment_commands')
            .select('target_user_id')
            .eq('id', commandId)
            .single();

        if (cmd?.target_user_id) {
            // Persist template to existing user
            await supabase
                .from('users')
                .update({ biometric: templateBase64 })
                .eq('id', cmd.target_user_id);
        }

        // Mark command complete with result payload
        await supabase
            .from('enrollment_commands')
            .update({
                status: 'completed',
                result_value: JSON.stringify({ fingerId, templateBase64 }),
                completed_at: new Date().toISOString()
            })
            .eq('id', commandId);

        return res.status(200).json({ success: true, data: { fingerId } });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 3.5 GET /api/device/config — ESP gets current mode and active session
app.get('/api/device/config', async (req, res) => {
    const { labId } = req.query;
    if (!labId) return res.status(400).json({ success: false, error: 'labId required' });
    if (!/^[A-Z0-9_]+$/.test(labId)) {
        return res.status(400).json({ success: false, error: 'Invalid labId format' });
    }

    try {
        const { data: device } = await supabase
            .from('devices')
            .select('current_mode, current_session_id')
            .eq('id', labId)
            .single();

        if (!device) return res.status(404).json({ success: false, error: 'Device not found' });

        return res.status(200).json({
            success: true,
            data: {
                mode: device.current_mode || 'attendance_either',
                sessionId: device.current_session_id
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 3.6 POST /api/device/heartbeat — ESP periodic status ping
app.post('/api/device/heartbeat', async (req, res) => {
    const { labId, freeHeap, uptime, rssi } = req.body;
    if (!labId) return res.status(400).json({ success: false, error: 'labId required' });
    if (!/^[A-Z0-9_]+$/.test(labId)) {
        return res.status(400).json({ success: false, error: 'Invalid labId format' });
    }

    try {
        const { data: device } = await supabase
            .from('devices')
            .select('current_session_id')
            .eq('id', labId)
            .single();

        const status = device?.current_session_id ? 'session_active' : 'online';

        await Promise.all([
            supabase.from('devices').update({ last_seen: new Date().toISOString(), status }).eq('id', labId),
            supabase.from('device_heartbeats').insert([{
                lab_id: labId,
                status: 'online',
                free_heap: freeHeap,
                uptime_seconds: uptime,
                wifi_rssi: rssi
            }])
        ]);

        return res.status(200).json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 3.7 GET /api/device/sync-time — ESP NTP time sync
app.get('/api/device/sync-time', (req, res) => {
    const now = new Date();
    return res.status(200).json({
        success: true,
        data: {
            unix: Math.floor(now.getTime() / 1000),
            iso: now.toISOString()
        }
    });
});

// ==========================================
// SESSION BIOMETRICS DOWNLOAD (ESP loads batch data)
// ==========================================

// 4.1 GET /api/professor/session/biometrics — ESP downloads batch biometrics for a session
app.get('/api/professor/session/biometrics', async (req, res) => {
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ success: false, error: 'sessionId required' });

    try {
        const { data: session, error: sessErr } = await supabase
            .from('timetable')
            .select('id, "batch-id", "lab id", mode, "Start time", "end time"')
            .eq('id', sessionId)
            .single();
        if (sessErr || !session) return res.status(404).json({ success: false, error: 'Session not found' });

        // Resolve students in the batch
        const { data: links } = await supabase
            .from('batches link')
            .select('id')
            .eq('batch id', session['batch-id']);

        const studentIds = links?.map(l => l.id).filter(Boolean) || [];
        if (!studentIds.length) return res.status(200).json({ success: true, data: { students: [] } });

        const { data: students, error: stuErr } = await supabase
            .from('users')
            .select('id, name, rfid, biometric')
            .in('id', studentIds);
        if (stuErr) throw stuErr;

        // Assign contiguous finger_id slots (1-200) only for students with templates
        let fingerId = 1;
        const studentsWithSlots = students.map(s => ({
            id: s.id,
            name: s.name,
            rfid: s.rfid,
            biometric: s.biometric,
            fingerId: s.biometric ? fingerId++ : null,
            hasRfid: !!s.rfid,
            hasFingerprint: !!s.biometric
        }));

        // Cache the finger_id → student mapping for attendance lookup
        const cacheRows = studentsWithSlots
            .filter(s => s.fingerId)
            .map(s => ({
                session_id: sessionId,
                student_id: s.id,
                finger_id: s.fingerId,
                rfid: s.rfid,
                uploaded_to_esp: false
            }));

        if (cacheRows.length) {
            await supabase.from('session_biometric_cache').upsert(cacheRows);
        }

        // Update device to reflect active session and mode
        await supabase
            .from('devices')
            .update({
                current_session_id: sessionId,
                status: 'session_active',
                current_mode: session.mode || 'attendance_either'
            })
            .eq('id', session['lab id']);

        return res.status(200).json({
            success: true,
            data: {
                sessionId,
                labId: session['lab id'],
                batchId: session['batch-id'],
                mode: session.mode || 'attendance_either',
                "Start time": session['Start time'],
                "end time": session['end time'],
                students: studentsWithSlots
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// ADMIN ENROLLMENT ENDPOINTS
// ==========================================

// 5.1 POST /api/admin/enrollment/start — Admin initiates device enrollment
app.post('/api/admin/enrollment/start', async (req, res) => {
    const { labId, type, userId } = req.body; // type: 'rfid' | 'fingerprint'
    if (!labId || !type) return res.status(400).json({ success: false, error: 'labId and type required' });

    try {
        // Cancel any pending commands for this lab first
        await supabase
            .from('enrollment_commands')
            .update({ status: 'timeout' })
            .eq('lab_id', labId)
            .eq('status', 'pending');

        // Create new enrollment command (expires in 5 minutes)
        const { data, error } = await supabase
            .from('enrollment_commands')
            .insert([{
                lab_id: labId,
                type,
                target_user_id: userId || null,
                expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
            }])
            .select()
            .single();

        if (error) throw error;

        // Signal device is in enrollment mode
        await supabase
            .from('devices')
            .update({ status: 'enrolling' })
            .eq('id', labId);

        // Publish enrollment command via MQTT
        mqttPublish(`lab/${labId}/control`, {
            command: type === 'rfid' ? 'ENROLL_RFID' : 'ENROLL_FINGERPRINT',
            cmd_id: data.id,
            target_user_id: userId || null
        });

        return res.status(200).json({ success: true, data: { commandId: data.id } });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 5.2 GET /api/admin/enrollment/status — Admin polls enrollment result
app.get('/api/admin/enrollment/status', async (req, res) => {
    const { labId, type } = req.query;
    if (!labId || !type) return res.status(400).json({ success: false, error: 'labId and type required' });

    try {
        const { data, error } = await supabase
            .from('enrollment_commands')
            .select('*')
            .eq('lab_id', labId)
            .eq('type', type)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error) throw error;

        return res.status(200).json({ success: true, data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// OFFLINE ATTENDANCE SYNC
// ==========================================

// POST /api/attendance/sync-offline — ESP submits queued records on reconnect
app.post('/api/attendance/sync-offline', async (req, res) => {
    const { records } = req.body; // Array of { labId, studentId, method, scannedAt, rawPayload }
    if (!Array.isArray(records) || !records.length) {
        return res.status(400).json({ success: false, error: 'records array required' });
    }

    try {
        const results = [];
        for (const r of records) {
            const scannedAt = r.scannedAt ? new Date(r.scannedAt) : new Date();
            const scannedDay = scannedAt.toLocaleDateString('en-US', { weekday: 'long' });
            const scannedTime = `${String(scannedAt.getHours()).padStart(2, '0')}:${String(scannedAt.getMinutes()).padStart(2, '0')}`;
            const scannedDate = new Date(scannedAt.getTime() - scannedAt.getTimezoneOffset() * 60000).toISOString().split('T')[0];

            // Find the matching timetable entry for this lab at the scanned time
            const { data: timetable } = await supabase
                .from('timetable')
                .select('id, "Start time"')
                .eq('lab id', r.labId)
                .filter('day of week', 'eq', scannedDay)
                .lte('Start time', scannedTime)
                .gte('end time', scannedTime)
                .limit(1)
                .single();

            if (!timetable) {
                results.push({ studentId: r.studentId, synced: false, reason: 'No matching session' });
                continue;
            }

            const startMinutes = timeToMinutes(timetable['Start time']);
            const scanMinutes = timeToMinutes(scannedTime);
            const isLate = scanMinutes > startMinutes + 15;

            const { error: insertErr } = await supabase
                .from('attendance')
                .insert([{
                    'student-id': r.studentId,
                    'timetable-id': timetable.id,
                    date: scannedDate,
                    status: isLate ? 'Late' : 'Present',
                    'marked by': r.method || 'ESP_Offline'
                }]);

            if (!insertErr) {
                await supabase
                    .from('offline_attendance_queue')
                    .update({ synced: true, synced_at: new Date().toISOString() })
                    .eq('lab_id', r.labId)
                    .eq('student_id', r.studentId)
                    .eq('scanned_at', r.scannedAt);
            }

            results.push({ studentId: r.studentId, synced: !insertErr, reason: insertErr?.message || null });
        }

        return res.status(200).json({ success: true, data: { results } });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/attendance/offline-rfid-sync — ESP uploads raw RFID scans captured during WiFi outage
app.post('/api/attendance/offline-rfid-sync', async (req, res) => {
    const { labId, records } = req.body;
    if (!labId || !Array.isArray(records) || !records.length) {
        return res.status(400).json({ success: false, error: 'labId and records array required' });
    }

    try {
        let processed = 0;
        const now = new Date();
        const isoNow = now.toISOString();
        const scannedDay = now.toLocaleDateString('en-US', { weekday: 'long' });
        const scannedTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const scannedDate = isoNow.split('T')[0];

        for (const r of records) {
            // Lookup student by RFID
            const { data: student, error: studentErr } = await supabase
                .from('users')
                .select('id, name')
                .eq('rfid', r.rfid)
                .single();

            if (studentErr || !student) {
                await supabase.from('offline_rfid_scans').insert([{
                    lab_id: labId,
                    rfid: r.rfid,
                    scanned_at: isoNow,
                    synced_at: isoNow,
                    status: 'student_not_found',
                    reason: 'No student found for this RFID'
                }]);
                continue;
            }

            // Find matching timetable for now
            const { data: timetable } = await supabase
                .from('timetable')
                .select('id, "Start time", "end time"')
                .eq('lab id', labId)
                .filter('day of week', 'eq', scannedDay)
                .lte('Start time', scannedTime)
                .gte('end time', scannedTime)
                .limit(1)
                .single();

            if (!timetable) {
                await supabase.from('offline_rfid_scans').insert([{
                    lab_id: labId,
                    rfid: r.rfid,
                    student_id: student.id,
                    scanned_at: isoNow,
                    synced_at: isoNow,
                    status: 'no_session',
                    reason: 'No active timetable session for this lab'
                }]);
                continue;
            }

            // Check for duplicate
            const { data: existing } = await supabase
                .from('attendance')
                .select('id')
                .eq('student-id', student.id)
                .eq('timetable-id', timetable.id)
                .eq('date', scannedDate)
                .maybeSingle();

            if (existing) {
                await supabase.from('offline_rfid_scans').insert([{
                    lab_id: labId,
                    rfid: r.rfid,
                    student_id: student.id,
                    scanned_at: isoNow,
                    synced_at: isoNow,
                    status: 'duplicate',
                    reason: 'Already marked for this session'
                }]);
                continue;
            }

            const startMinutes = timeToMinutes(timetable['Start time']);
            const scanMinutes = timeToMinutes(scannedTime);
            const isLate = scanMinutes > startMinutes + 15;
            const statusLabel = isLate ? 'Late' : 'Present';

            const { error: insertErr } = await supabase.from('attendance').insert([{
                'student-id': student.id,
                'timetable-id': timetable.id,
                date: scannedDate,
                status: statusLabel,
                'marked by': 'ESP_OfflineRFID'
            }]);

            if (insertErr) {
                await supabase.from('offline_rfid_scans').insert([{
                    lab_id: labId,
                    rfid: r.rfid,
                    student_id: student.id,
                    scanned_at: isoNow,
                    synced_at: isoNow,
                    status: 'pending',
                    reason: 'Attendance insert failed: ' + insertErr.message
                }]);
                continue;
            }

            await supabase.from('offline_rfid_scans').insert([{
                lab_id: labId,
                rfid: r.rfid,
                student_id: student.id,
                scanned_at: isoNow,
                synced_at: isoNow,
                status: 'processed',
                reason: null
            }]);
            processed++;
        }

        return res.status(200).json({ success: true, data: { processed } });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// ANALYTICS & DASHBOARD ENDPOINTS
// ==========================================

// 8.1 GET /api/analytics/student/:id — Student self-monitoring dashboard
app.get('/api/analytics/student/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const { data: attendance } = await supabase
            .from('attendance')
            .select('*')
            .eq('student-id', id);

        const total = attendance?.length || 0;
        const present = attendance?.filter(a => a.status === 'Present').length || 0;
        const late = attendance?.filter(a => a.status === 'Late').length || 0;
        const absent = total - present - late;
        const percent = total > 0 ? Math.round(((present + late) / total) * 100) : 0;

        // How many more consecutive absences before dropping below 75%
        const threshold = 75;
        let canMiss = 0;
        if (percent >= threshold) {
            let tP = present + late;
            let tT = total;
            while (tT > 0 && Math.round((tP / tT) * 100) >= threshold) {
                canMiss++;
                tT++;
            }
            canMiss = Math.max(0, canMiss - 1);
        }

        const punctualityScore = total > 0 ? Math.round((present / total) * 100) : 0;
        const rfidCount = attendance?.filter(a => a['marked by'] === 'RFID').length || 0;
        const fpCount = attendance?.filter(a => a['marked by'] === 'Fingerprint' || a['marked by'] === 'Biometric').length || 0;

        const { data: history } = await supabase
            .from('attendance')
            .select('*, "timetable-id"')
            .eq('student-id', id)
            .order('date', { ascending: false })
            .limit(20);

        return res.json({ success: true, data: {
            stats: { total, present, late, absent, percent },
            eligibility: { canMissMore: canMiss, threshold, currentPercent: percent },
            punctuality: { score: punctualityScore, onTime: present, late },
            modePreference: { rfid: rfidCount, fingerprint: fpCount },
            history: history || []
        }});
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 8.2 GET /api/analytics/professor/dashboard — Professor classroom analytics
app.get('/api/analytics/professor/dashboard', async (req, res) => {
    const { professorId } = req.query;
    if (!professorId) return res.status(400).json({ success: false, error: 'professorId required' });

    try {
        // Get professor's labs
        const { data: assignments } = await supabase
            .from('professors-labs')
            .select('id')
            .eq('prof-id', professorId);
        const labIds = (assignments || []).map(a => a.id);
        if (!labIds.length) return res.json({ success: true, data: { sessions: [], trends: [], atRisk: [], modePreference: { rfid: 0, fingerprint: 0 } } });

        // Get timetable entries for those labs
        const { data: timetables } = await supabase
            .from('timetable')
            .select('id, "lab id", mode')
            .in('lab id', labIds);
        const ttIds = (timetables || []).map(t => t.id);
        if (!ttIds.length) return res.json({ success: true, data: { sessions: [], trends: [], atRisk: [], modePreference: { rfid: 0, fingerprint: 0 } } });

        // Get all attendance for those sessions
        const { data: attendance } = await supabase
            .from('attendance')
            .select('*, "student-id"')
            .in('timetable-id', ttIds)
            .order('date', { ascending: false });

        // Group by timetable for per-session stats
        const sessionMap = {};
        for (const a of attendance || []) {
            const tid = a['timetable-id'];
            if (!sessionMap[tid]) sessionMap[tid] = { total: 0, present: 0, late: 0, students: new Set() };
            sessionMap[tid].total++;
            if (a.status === 'Present') sessionMap[tid].present++;
            if (a.status === 'Late') sessionMap[tid].late++;
            sessionMap[tid].students.add(a['student-id']);
        }

        // Daily trends (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const { data: recentAttendance } = await supabase
            .from('attendance')
            .select('date, status')
            .in('timetable-id', ttIds)
            .gte('date', thirtyDaysAgo.toISOString().split('T')[0])
            .order('date');

        const dailyMap = {};
        for (const a of recentAttendance || []) {
            const d = a.date;
            if (!dailyMap[d]) dailyMap[d] = { present: 0, late: 0, total: 0 };
            dailyMap[d].total++;
            if (a.status === 'Present') dailyMap[d].present++;
            if (a.status === 'Late') dailyMap[d].late++;
        }
        const trends = Object.entries(dailyMap).map(([date, d]) => ({
            date, rate: d.total > 0 ? Math.round(((d.present + d.late) / d.total) * 100) : 0
        })).sort((a, b) => a.date.localeCompare(b.date));

        // At-risk students: attendance drop > 15% comparing last 2 weeks vs previous 2 weeks
        const now = new Date();
        const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000).toISOString().split('T')[0];
        const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000).toISOString().split('T')[0];

        const { data: recent2w } = await supabase
            .from('attendance')
            .select('*, "student-id"')
            .in('timetable-id', ttIds)
            .gte('date', twoWeeksAgo);

        const { data: prev2w } = await supabase
            .from('attendance')
            .select('*, "student-id"')
            .in('timetable-id', ttIds)
            .gte('date', fourWeeksAgo)
            .lt('date', twoWeeksAgo);

        const calcRate = (records) => {
            if (!records?.length) return 0;
            const p = records.filter(r => r.status === 'Present' || r.status === 'Late').length;
            return Math.round((p / records.length) * 100);
        };

        const studentIds = [...new Set([...(recent2w || []), ...(prev2w || [])].map(r => r['student-id']))];
        const atRisk = [];
        for (const sid of studentIds) {
            const recent = (recent2w || []).filter(r => r['student-id'] === sid);
            const prev = (prev2w || []).filter(r => r['student-id'] === sid);
            const recentRate = calcRate(recent);
            const prevRate = calcRate(prev);
            if (prevRate > 0 && (prevRate - recentRate) > 15) {
                const { data: u } = await supabase.from('users').select('name').eq('id', sid).single();
                atRisk.push({ studentId: sid, name: u?.name || 'Unknown', prevRate, recentRate, drop: prevRate - recentRate });
            }
        }

        // Mode preference across all attendance
        let modeRfid = 0, modeFp = 0;
        for (const a of attendance || []) {
            if (a['marked by'] === 'RFID') modeRfid++;
            else if (a['marked by'] === 'Fingerprint' || a['marked by'] === 'Biometric') modeFp++;
        }

        return res.json({ success: true, data: {
            sessions: Object.entries(sessionMap).map(([tid, s]) => ({
                timetableId: tid, total: s.total, present: s.present, late: s.late,
                studentCount: s.students.size,
                rate: s.total > 0 ? Math.round(((s.present + s.late) / s.total) * 100) : 0
            })),
            trends,
            atRisk,
            modePreference: { rfid: modeRfid, fingerprint: modeFp }
        }});
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 8.3 GET /api/analytics/professor/heatmap — Arrival time distribution
app.get('/api/analytics/professor/heatmap', async (req, res) => {
    const { professorId } = req.query;
    if (!professorId) return res.status(400).json({ success: false, error: 'professorId required' });

    try {
        const { data: assignments } = await supabase
            .from('professors-labs')
            .select('id')
            .eq('prof-id', professorId);
        const labIds = (assignments || []).map(a => a.id);

        const { data: timetables } = await supabase
            .from('timetable')
            .select('id, "Start time"')
            .in('lab id', labIds);
        const ttIds = (timetables || []).map(t => t.id);

        const { data: attendance } = await supabase
            .from('attendance')
            .select('date, status')
            .in('timetable-id', ttIds);

        // Group by hour of day based on session start times
        const heatmap = {};
        for (const tt of timetables || []) {
            const hour = parseInt(tt['Start time']?.split(':')[0] || '0');
            const key = `${hour}:00-${hour + 1}:00`;
            if (!heatmap[key]) heatmap[key] = { slot: key, count: 0 };
        }
        // Count attendance per time slot
        for (const a of attendance || []) {
            const tt = timetables?.find(t => t.id === a['timetable-id']);
            if (tt) {
                const hour = parseInt(tt['Start time']?.split(':')[0] || '0');
                const key = `${hour}:00-${hour + 1}:00`;
                if (heatmap[key]) heatmap[key].count++;
            }
        }

        return res.json({ success: true, data: Object.values(heatmap).sort((a, b) => a.slot.localeCompare(b.slot)) });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 8.4 GET /api/analytics/admin/overview — Admin system-wide dashboard
app.get('/api/analytics/admin/overview', async (req, res) => {
    const { batchId, labId, studentId, period } = req.query;

    try {
        // Build date filter
        let dateFilter = {};
        if (period === 'today') {
            const today = new Date().toISOString().split('T')[0];
            dateFilter = { gte: today, lte: today };
        } else if (period === 'week') {
            const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
            dateFilter = { gte: weekAgo };
        } else if (period === 'month') {
            const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
            dateFilter = { gte: monthAgo };
        }

        // Users count
        const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: totalStudents } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'student');
        const { count: totalProfessors } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'professor');

        // Labs count
        const { count: totalLabs } = await supabase.from('labs').select('*', { count: 'exact', head: true });

        // Devices status
        const { data: devices } = await supabase.from('devices').select('id, status, last_seen');
        const onlineDevices = devices?.filter(d => d.status === 'online' || d.status === 'session_active').length || 0;
        const offlineDevices = devices?.filter(d => d.status === 'offline' || !d.status).length || 0;
        const sleepDevices = devices?.filter(d => d.status === 'sleep').length || 0;

        // Attendance stats
        let attendanceQuery = supabase.from('attendance').select('*, "student-id", "timetable-id"');
        if (dateFilter.gte) attendanceQuery = attendanceQuery.gte('date', dateFilter.gte);
        if (dateFilter.lte) attendanceQuery = attendanceQuery.lte('date', dateFilter.lte);

        const { data: attendance } = await attendanceQuery;
        const totalAttendance = attendance?.length || 0;
        const presentCount = attendance?.filter(a => a.status === 'Present').length || 0;
        const lateCount = attendance?.filter(a => a.status === 'Late').length || 0;
        const globalRate = totalAttendance > 0 ? Math.round(((presentCount + lateCount) / totalAttendance) * 100) : 0;

        // Most utilized lab
        const labAttendance = {};
        for (const a of attendance || []) {
            const tid = a['timetable-id'];
            if (!labAttendance[tid]) labAttendance[tid] = 0;
            labAttendance[tid]++;
        }
        const topLab = Object.entries(labAttendance).sort((a, b) => b[1] - a[1])[0];
        let mostUtilizedLab = 'N/A';
        if (topLab) {
            const { data: tt } = await supabase.from('timetable').select('"lab id"').eq('id', topLab[0]).single();
            if (tt) mostUtilizedLab = tt['lab id'];
        }

        // Highest yield batch
        const batchAttendance = {};
        for (const a of attendance || []) {
            const sid = a['student-id'];
            if (!batchAttendance[sid]) batchAttendance[sid] = 0;
            batchAttendance[sid]++;
        }

        // Sensor error rates (device_heartbeats with low free_heap or offline_rfid_scans with errors)
        const { data: errorScans } = await supabase
            .from('offline_rfid_scans')
            .select('*')
            .in('status', ['student_not_found', 'no_session', 'duplicate']);
        const errorCount = errorScans?.length || 0;

        // Device error tracking from heartbeats
        const { data: heartbeats } = await supabase
            .from('device_heartbeats')
            .select('lab_id, free_heap, wifi_rssi')
            .order('received_at', { ascending: false })
            .limit(50);
        const lowMemoryDevices = heartbeats?.filter(h => h.free_heap < 50000).length || 0;

        return res.json({ success: true, data: {
            users: { total: totalUsers || 0, students: totalStudents || 0, professors: totalProfessors || 0 },
            labs: { total: totalLabs || 0 },
            devices: { online: onlineDevices, offline: offlineDevices, sleep: sleepDevices, total: devices?.length || 0 },
            attendance: { total: totalAttendance, present: presentCount, late: lateCount, rate: globalRate },
            mostUtilizedLab,
            hardwareAlerts: errorCount + lowMemoryDevices,
            sensorErrors: errorCount,
            lowMemoryDevices
        }});
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 8.5 GET /api/analytics/admin/enrollment-progress — Biometric onboarding tracking
app.get('/api/analytics/admin/enrollment-progress', async (req, res) => {
    try {
        const { count: totalStudents } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'student');
        const { count: hasRfid } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'student').not('rfid', 'is', null);
        const { count: hasBiometric } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'student').not('biometric', 'is', null);
        const { count: hasBoth } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'student').not('rfid', 'is', null).not('biometric', 'is', null);
        const { count: hasNone } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'student').is('rfid', null).is('biometric', null);

        return res.json({ success: true, data: {
            total: totalStudents || 0,
            enrolledRfid: hasRfid || 0,
            enrolledBiometric: hasBiometric || 0,
            enrolledBoth: hasBoth || 0,
            notEnrolled: hasNone || 0
        }});
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 8.6 GET /api/analytics/admin/bypass-log — Track force-initialized sessions
app.get('/api/analytics/admin/bypass-log', async (req, res) => {
    try {
        // Count sessions initialized outside timetable hours by checking
        // enrollment_commands with type 'load_session' that were created
        // when no active timetable slot existed
        const { data: devices } = await supabase
            .from('devices')
            .select('id, current_session_id');
        
        const bypassCount = devices?.filter(d => d.current_session_id).length || 0;
        
        // Get the actual bypass events from enrollment_commands
        const { data: bypassEvents } = await supabase
            .from('enrollment_commands')
            .select('created_at, lab_id')
            .eq('type', 'load_session')
            .order('created_at', { ascending: false })
            .limit(20);

        return res.json({ success: true, data: {
            totalBypasses: bypassEvents?.length || 0,
            activeBypasses: bypassCount,
            recentBypasses: (bypassEvents || []).map(e => ({
                labId: e.lab_id,
                timestamp: e.created_at
            }))
        }});
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// ==========================================
setInterval(async () => {
    try {
        const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString();
        const { error } = await supabase
            .from('enrollment_commands')
            .update({ status: 'pending' })
            .eq('status', 'sent')
            .lt('sent_at', thirtySecondsAgo);
        if (error) console.error('[CLEANUP ERROR]', error);
    } catch (err) {
        console.error('[CLEANUP ERROR]', err);
    }
}, 30000);

// Start listening for inbound pipelines
app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` 🟢 QUADRODEEP AUTOMATION BACKEND ENGINE OPERATIONAL `);
    console.log(` 🚀 Listening for client requests on port: ${PORT}   `);
    console.log(`=======================================================`);
});
