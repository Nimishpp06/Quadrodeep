function studentLateWarning(data) {
    const { studentName, sessionName, scheduledTime, actualTime, minutesLate, labName } = data;
    
    const html = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #d32f2f; color: white; padding: 20px; text-align: center;">
                <h2 style="margin: 0;">Late Attendance Warning</h2>
            </div>
            <div style="padding: 20px;">
                <p>Hello <strong>${studentName}</strong>,</p>
                <p>You have been marked <strong>LATE</strong> for the <strong>${sessionName}</strong> session.</p>
                <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">Lab:</td>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${labName}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">Scheduled Start:</td>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${scheduledTime}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">Scanned Time:</td>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${actualTime}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">Minutes Late:</td>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd; color: #d32f2f; font-weight: bold;">${minutesLate} mins</td>
                    </tr>
                </table>
                <p style="margin-top: 20px; font-size: 0.9em; color: #555;">Please ensure you arrive on time for future sessions to maintain your attendance standing.</p>
            </div>
        </div>
    `;

    const text = `
Hello ${studentName},

You have been marked LATE for the ${sessionName} session.

Lab: ${labName}
Scheduled Start: ${scheduledTime}
Scanned Time: ${actualTime}
Minutes Late: ${minutesLate} mins

Please ensure you arrive on time for future sessions.
    `.trim();

    return { html, text };
}

function professorReminder(data) {
    const { professorName, sessionName, labName, batchName, startTime, minutesUntil } = data;
    
    const html = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #1976d2; color: white; padding: 20px; text-align: center;">
                <h2 style="margin: 0;">Session Reminder</h2>
            </div>
            <div style="padding: 20px;">
                <p>Hello <strong>Professor ${professorName}</strong>,</p>
                <p>Your upcoming session is starting in <strong>${minutesUntil} minutes</strong>.</p>
                <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">Session:</td>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${sessionName}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">Lab:</td>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${labName}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">Batch:</td>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${batchName}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">Start Time:</td>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd; color: #1976d2; font-weight: bold;">${startTime}</td>
                    </tr>
                </table>
                <p style="margin-top: 20px; font-size: 0.9em; color: #555;">Please prepare the lab equipment as needed.</p>
            </div>
        </div>
    `;

    const text = `
Hello Professor ${professorName},

Your upcoming session is starting in ${minutesUntil} minutes.

Session: ${sessionName}
Lab: ${labName}
Batch: ${batchName}
Start Time: ${startTime}

Please prepare the lab equipment as needed.
    `.trim();

    return { html, text };
}

module.exports = { studentLateWarning, professorReminder };
