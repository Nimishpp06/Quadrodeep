const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../utils/resendClient');
const { studentLateWarning, professorReminder } = require('../templates/emailTemplates');
require('dotenv').config();


async function checkAndSendLateWarning(supabase, studentId, sessionId, scannedAt) {
    try {
        const { data: existingLog } = await supabase
            .from('notification_log')
            .select('id')
            .eq('user_id', studentId)
            .eq('session_id', sessionId)
            .eq('type', 'late_warning')
            .single();

        if (existingLog) return;

        const { data: student } = await supabase
            .from('users')
            .select('name, email, role')
            .eq('id', studentId)
            .single();

        if (!student || !student.email || student.role !== 'student') return;

        const { data: session } = await supabase
            .from('timetable')
            .select('"start time", labs(name), batches(name)')
            .eq('id', sessionId)
            .single();

        if (!session) return;

        const startTimeParts = session['start time'].split(':');
        const startHour = parseInt(startTimeParts[0]);
        const startMin = parseInt(startTimeParts[1]);
        
        const scanHour = scannedAt.getHours();
        const scanMin = scannedAt.getMinutes();
        
        const startTotalMins = startHour * 60 + startMin;
        const scanTotalMins = scanHour * 60 + scanMin;
        const minutesLate = scanTotalMins - startTotalMins;

        if (minutesLate <= 15) return;

        const templates = studentLateWarning({
            studentName: student.name,
            sessionName: 'Lab Session',
            scheduledTime: session['start time'],
            actualTime: `${String(scanHour).padStart(2, '0')}:${String(scanMin).padStart(2, '0')}`,
            minutesLate,
            labName: session.labs?.name || 'Unknown Lab'
        });

        const result = await sendEmail({
            to: student.email,
            subject: 'Late Attendance Warning',
            html: templates.html,
            text: templates.text
        });

        if (result.success) {
            await supabase.from('notification_log').insert({
                user_id: studentId,
                type: 'late_warning',
                session_id: sessionId
            });
        }
    } catch (error) {
        console.error('Error in checkAndSendLateWarning:', error);
    }
}

async function checkAndSendProfessorReminders(supabase) {
    try {
        const now = new Date();
        const targetTime = new Date(now.getTime() + 5 * 60000);
        
        const targetDay = targetTime.toLocaleDateString('en-US', { weekday: 'long' });
        const targetTimeShort = `${String(targetTime.getHours()).padStart(2, '0')}:${String(targetTime.getMinutes()).padStart(2, '0')}`;

        const { data: upcomingSessions } = await supabase
            .from('timetable')
            .select('id, "start time", "professor id", labs(name), batches(name)')
            .eq('day of week', targetDay)
            .like('start time', `${targetTimeShort}%`);

        if (!upcomingSessions || upcomingSessions.length === 0) return;

        for (const session of upcomingSessions) {
            const profId = session['professor id'];
            if (!profId) continue;

            const { data: existingLog } = await supabase
                .from('notification_log')
                .select('id')
                .eq('user_id', profId)
                .eq('session_id', session.id)
                .eq('type', 'professor_reminder')
                .single();

            if (existingLog) continue;

            const { data: professor } = await supabase
                .from('users')
                .select('name, email, role')
                .eq('id', profId)
                .single();

            if (!professor || !professor.email || professor.role !== 'professor') continue;

            const templates = professorReminder({
                professorName: professor.name,
                sessionName: 'Upcoming Lab Session',
                labName: session.labs?.name || 'Unknown Lab',
                batchName: session.batches?.name || 'Unknown Batch',
                startTime: session['start time'],
                minutesUntil: 5
            });

            const result = await sendEmail({
                to: professor.email,
                subject: 'Reminder: Upcoming Session in 5 Minutes',
                html: templates.html,
                text: templates.text
            });

            if (result.success) {
                await supabase.from('notification_log').insert({
                    user_id: profId,
                    type: 'professor_reminder',
                    session_id: session.id
                });
            }
        }
    } catch (error) {
        console.error('Error in checkAndSendProfessorReminders:', error);
    }
}

module.exports = { checkAndSendLateWarning, checkAndSendProfessorReminders };
