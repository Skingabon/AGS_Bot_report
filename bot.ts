import 'dotenv/config';
import cron from 'node-cron';
import { Bot } from 'grammy';
import { createReportTimeByPeriod } from './modules/timeReport';
import { sendGoogleSheetLinkByEmail } from './modules/emailSender';
import { updateAllFiled, updateIncomingCall } from './modules/updateFields';
import {
  accessCreateReport,
  botContext,
  fnStartingCommand,
  protectedSetIncomingCall,
  protectedReportMarketing,
  protectedReportTimeLastDay,
  protectedReportTimePeriod,
  protectedSendGoogleLink,
  reportLeadPeriod,
  reportLeadToday,
  reportLeadYesterday,
  onChangeDatePeriod,
  sortTableByDate,
} from './modules/generalFn';
import { changeMonth } from './util/calendar';

const bot = new Bot(process.env.BOT_API_KEY || '');

bot.api.setMyCommands([
  { command: 'start', description: 'Start AGS_Bot_Report' },
]);

bot.command('start', fnStartingCommand);

bot.callbackQuery('generate-for-quartet', (ctx) =>
  protectedSetIncomingCall(ctx),
);
bot.callbackQuery('generate', (ctx) => protectedSetIncomingCall(ctx, true));
bot.callbackQuery('report-time-last-day-for-quarter', (ctx) =>
  protectedReportTimeLastDay(ctx),
);

// Сортировка
bot.callbackQuery('sort-for-quartet', (ctx) => sortTableByDate(ctx));
bot.callbackQuery('sort-all', (ctx) => sortTableByDate(ctx, true));

bot.callbackQuery('report-time-last-day', protectedReportTimeLastDay);
bot.callbackQuery('report-time-period', protectedReportTimePeriod);
bot.callbackQuery('send-google-link', protectedSendGoogleLink);
bot.callbackQuery('report-marketing-period', protectedReportMarketing);

bot.callbackQuery('report-lead-yesterday', reportLeadYesterday);
bot.callbackQuery('report-lead-today', reportLeadToday);
bot.callbackQuery('report-lead-period', reportLeadPeriod);

bot.callbackQuery('menu', fnStartingCommand);
bot.callbackQuery('access-create-report', accessCreateReport);

// Календарь
bot.callbackQuery(/cal_date_(.+)/, onChangeDatePeriod);
bot.callbackQuery(/cal_(prev|next)_(\d+)_(\d+)/, changeMonth);

//Ежедневное заполнение отчета в 23.40
cron.schedule('40 23 * * *', async () => {
  const fs = require('fs');
  const logDir = './logs';
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFile = `${logDir}/report.log`;
  fs.appendFileSync(logFile, `${new Date().toISOString()} Начало отчета \n`);

  try {
    await createReportTimeByPeriod();
    await updateAllFiled();
    await updateIncomingCall();
  } catch (error) {
    if (error instanceof Error)
      fs.appendFileSync(
        logFile,
        `${new Date().toISOString()} Ошибка отчета ${error.message}\n`,
      );
  } finally {
    fs.appendFileSync(logFile, `${new Date().toISOString()} Конец отчета \n`);
  }
});

//Ежедневная отправка ссылки неа отчет в 9.00
cron.schedule('00 09 * * *', async () => {
  console.log('Запуск ежедневного отчета на почту...');
  try {
    const userEmail = process.env.RECEIVER_EMAIL; // куда отправляем письмо
    const googleSheetUrl = process.env.GOOGLE_SHEET_URL; // ссылка на гугл-таблицу

    if (!userEmail || !googleSheetUrl) {
      return console.log('Неверные данные');
    }

    await sendGoogleSheetLinkByEmail(userEmail, googleSheetUrl);
    if (botContext) {
      console.log('Ссылка на Google Таблицу отправлена на почту!');
    }
  } catch (err) {
    if (botContext) {
      console.log(`Ошибка при отправке на почту: ${err}`);
    }
  }
});

bot.start();
