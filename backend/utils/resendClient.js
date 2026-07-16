const { Resend } = require('resend');
const { withRetry } = require('./retryHelper');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

// Simple in-memory rate limiter
let emailsSentThisHour = 0;
let currentHour = new Date().getHours();

async function sendEmail({ to, subject, html, text, from = process.env.FROM_EMAIL, replyTo = process.env.REPLY_TO_EMAIL }) {
    const nowHour = new Date().getHours();
    
    // Reset counter if it's a new hour
    if (nowHour !== currentHour) {
        currentHour = nowHour;
        emailsSentThisHour = 0;
    }

    // Check rate limit: 100 emails/hour (Resend free tier)
    if (emailsSentThisHour >= 100) {
        console.warn('⚠️ Rate limit reached (100 emails/hour). Dropping email to:', to);
        return { success: false, error: 'Rate limit exceeded' };
    }

    try {
        const data = await withRetry(async () => {
            return await resend.emails.send({
                from,
                to,
                reply_to: replyTo,
                subject,
                html,
                text
            });
        });

        emailsSentThisHour++;
        console.log(`📧 Email sent successfully to ${to} (Hourly usage: ${emailsSentThisHour}/100)`);
        return { success: true, data };
    } catch (error) {
        console.error('❌ Failed to send email after retries:', error);
        return { success: false, error: error.message };
    }
}

module.exports = { sendEmail, resend };
