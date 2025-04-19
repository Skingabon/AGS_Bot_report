import 'dotenv/config';
import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import {
  createGoogleFields,
  domain,
  getAllPipelines,
  getGoogleSheetData,
  getLeadToday,
  getNotesByLead,
  Pipeline,
  updateGoogleField,
  updateLeadDateCall,
} from './api';
import { getDate } from './helper';

const bot = new Bot(process.env.BOT_API_KEY || '');

bot.api.setMyCommands([
  { command: 'start', description: 'Start AGS_Bot_Report' },
]);

const menuKeyboard = new Keyboard()
  .text('/generate')
  .row() // Вторая строка
  // .resized() // Автоматический размер кнопок
  // .persistent(); // Меню не скрывается после нажатия
  .text('/report-time')
  .row(); // Вторая строка
bot.command('start', async (ctx) => {
  await ctx.reply('Выберите команду:', {
    reply_markup: menuKeyboard,
  });
});
bot.command('report-time', async (ctx) => {
  try {
    const pipelinesResponse = await getAllPipelines();
    const pipelines = pipelinesResponse;
    const pipelinesMap = pipelines.reduce(
      (
        acc: { [key: number]: string },
        pipeline: { id: number; name: string },
      ) => {
        acc[pipeline.id] = pipeline.name;
        return acc;
      },
      {},
    );
    // Пример временных меток (начало и конец дня)
    const startTimestamp = Math.floor(
      new Date('2023-04-18T00:00:00').getTime() / 1000,
    );
    const endTimestamp = Math.floor(
      new Date('2023-04-18T23:59:59').getTime() / 1000,
    );
    const response = await getLeadToday(startTimestamp, endTimestamp);
    const leads = response;

    if (!leads || leads.length === 0) {
      throw new Error('No leads found for the given filter.');
    }

    // Преобразование данных для загрузки в Google Sheets
    const googleSheetsData = leads.map((lead) => {
      // Получаем название воронки по ID
      const pipelineName = pipelinesMap[lead.pipeline_id] || 'Не найдено';

      // Добавляем название статуса в зависимости от ID статуса
      let statusName = '';
      if (lead.status_id === 142) {
        statusName = 'Успешно реализовано';
      } else if (lead.status_id === 143) {
        statusName = 'Закрыто и не реализовано';
      }

      return [
        lead.id, // ID
        lead.name,
        lead.price,
        lead.status_id, // ID статуса
        statusName, // Название статуса
        pipelineName, // Название воронки
        new Date(lead.created_at * 1000).toLocaleString(),
        new Date(lead.updated_at * 1000).toLocaleString(),
        `https://${domain}.amocrm.ru/leads/detail/${lead.id}`, // Ссылка на лид
      ];
    });
    // Подготовка данных для загрузки в таблицу
    const resource = {
      values: [
        [
          'ID',
          'Название',
          'Цена',
          'Статус ID',
          'Название статуса',
          'Название Воронки',
          'Дата создания',
          'Дата обновления',
          'Ссылка на лид',
        ],
        ...googleSheetsData,
      ],
    };
    await createGoogleFields(resource);
  } catch (error) {
    if (error instanceof Error) await ctx.reply('error' + error.message);
  }
});

bot.command('generate', async (ctx) => {
  await ctx.reply('Начинаем!');
  const idsLead = await getGoogleSheetData();
  let i = 2;
  for (const el of idsLead.flat()) {
    const idLead = Number(el);
    try {
      const note = await getNotesByLead(idLead);

      if (!note) {
        console.log('note', note);
        throw new Error(`Сделка ${idLead} завершена `);
      }
      const outgoingCalls = note
        .filter((el) => el.note_type === 'call_out')
        .sort((a, b) => a.created_at - b.created_at);

      if (outgoingCalls.length === 0) {
        throw new Error(`Для сделки ${idLead} исходящих звонков не найдено`);
      }

      const firstCall = outgoingCalls[0]; // Берем самый первый звонок
      const date = getDate(firstCall.created_at);
      await Promise.all([
        updateLeadDateCall(idLead, date),
        updateGoogleField(date, i),
      ]);
    } catch (err) {
      if (err instanceof Error) await ctx.reply(`Ошибка: ${err.message}`);
    } finally {
      i++;
    }
  }
  await ctx.reply('Готово!');
});

bot.start();
