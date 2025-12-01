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
import {
  getLastRowGoogleSheet,
  updateFieldsGooglePack,
} from './services/apiGoogleTable';
import { getLeadsToday } from './services/apiAmo';
import { formatDateMMDDYYYYByDate } from './util/helper';

const bot = new Bot(process.env.BOT_API_KEY || '');

bot.api.setMyCommands([
  { command: 'start', description: 'Start AGS_Bot_Report' },
]);

bot.command('start', fnStartingCommand);

bot.callbackQuery('generate-for-quartet', (ctx) =>
  protectedSetIncomingCall(ctx),
);
bot.callbackQuery('incoming-call', (ctx) =>
  protectedSetIncomingCall(ctx, true),
);
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
bot.callbackQuery('test', async () => {});

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
  let errorMsg = 'Без ошибок';
  const fs = require('fs');
  const logDir = './logs';
  const today = formatDateMMDDYYYYByDate(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const lastRowBeforeFill = await getLastRowGoogleSheet();

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFile = `${logDir}/report.log`;
  fs.appendFileSync(logFile, `${today} Начало отчета \n`);

  try {
    await createReportTimeByPeriod();
    await updateAllFiled();
    await updateIncomingCall();
  } catch (error) {
    if (error instanceof Error) {
      errorMsg = error.message;
      fs.appendFileSync(
        logFile,
        `${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()} Ошибка отчета ${error.message}\n`,
      );
    }
  } finally {
    const startOfDay = new Date(yesterday);
    const endOfDay = new Date(yesterday);

    startOfDay.setHours(0, 0, 0, 0);
    endOfDay.setHours(23, 59, 59, 999);

    // Конвертируем в Unix timestamp (секунды)
    const startTimestamp = Math.floor(startOfDay.getTime() / 1000);
    const endTimestamp = Math.floor(endOfDay.getTime() / 1000);

    const allLeadByPeriod = await getLeadsToday(startTimestamp, endTimestamp);

    const lastRow = await getLastRowGoogleSheet();
    const sheetUpdates: {
      range: string;
      values: (string | number)[][];
    }[] = [];

    sheetUpdates.push({
      range: `AN${lastRow}:AP`,
      values: [[errorMsg, today, lastRow - lastRowBeforeFill]],
    });
    sheetUpdates.push({
      range: `AQ${lastRowBeforeFill}`,
      values: [[allLeadByPeriod.length]],
    });

    await updateFieldsGooglePack(sheetUpdates);
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
