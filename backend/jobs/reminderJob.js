const { checkAndSendProfessorReminders } = require('../services/notificationService');

module.exports = function(supabase) {
    console.log('⏳ Initializing Reminder Job...');

    // Run every minute
    setInterval(async () => {
        await checkAndSendProfessorReminders(supabase);
    }, 60000);
};
