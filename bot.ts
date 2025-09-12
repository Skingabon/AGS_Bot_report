import 'dotenv/config';
import cron from 'node-cron';
import { Bot } from 'grammy';
import {
  createReportTimeByPeriod,
  showReportLeadByPeriod,
  showReportLeadByYesterday,
} from './modules/timeReport';
import { sendGoogleSheetLinkByEmail } from './modules/emailSender';
import { updateAllFiled, updateIncomingCall } from './modules/updateFields';
import {
  accessCreateReport,
  botContext,
  fnStartingCommand,
  onInputText,
  protectedGenerate,
  protectedReportMarketing,
  protectedReportTimeLastDay,
  protectedReportTimePeriod,
  protectedSendGoogleLink,
  reportLeadPeriod,
} from './modules/generalFn';

const bot = new Bot(process.env.BOT_API_KEY || '');

bot.api.setMyCommands([
  { command: 'start', description: 'Start AGS_Bot_Report' },
]);

bot.command('start', fnStartingCommand);

bot.callbackQuery('generate', protectedGenerate);
bot.callbackQuery('report-time-last-day', protectedReportTimeLastDay);
bot.callbackQuery('report-time-period', protectedReportTimePeriod);
bot.callbackQuery('send-google-link', protectedSendGoogleLink);
bot.callbackQuery('report-marketing-period', protectedReportMarketing);

bot.callbackQuery('report-lead-yesterday', async (ctx) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayDate = yesterday.toLocaleDateString('ru-Ru');
  await showReportLeadByYesterday(ctx, yesterdayDate);
  await ctx.answerCallbackQuery();
});
bot.callbackQuery('report-lead-today', async (ctx) => {
  const currentDate = new Date().toLocaleDateString('ru-RU');
  await showReportLeadByPeriod(ctx, currentDate);
  await ctx.answerCallbackQuery();
});
bot.callbackQuery('report-lead-period', reportLeadPeriod);
bot.callbackQuery('menu', fnStartingCommand);
bot.callbackQuery('access-create-report', accessCreateReport);

bot.on('message:text', onInputText);

//Ежедневное заполнение отчета в 23.40
cron.schedule('40 23 * * *', async () => {
  console.log('Запуск ежедневного обновления...');
  await createReportTimeByPeriod(botContext).catch(console.error);
  await updateAllFiled(botContext).catch(console.error);
  await updateIncomingCall(botContext).catch(console.error);
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
      await botContext.reply('Ссылка на Google Таблицу отправлена на почту!');
    }
  } catch (err) {
    console.error(err);
    if (botContext) {
      await botContext.reply(`Ошибка при отправке на почту: ${err}`);
    }
  }
});

bot.start();
