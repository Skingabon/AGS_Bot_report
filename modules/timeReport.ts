import { Context } from 'grammy';
import {
  createGoogleFields,
  domain,
  getAllPipelines,
  getGoogleSheetData,
  getLeadToday,
  getNotesByLead,
  updateGoogleField,
  updateLeadDateCall,
} from '../api';
import { getDate } from '../helper';

export const updateIncomingCall = async (ctx: Context | null) => {
  if (!ctx) return;
  await ctx.reply('Начинаем проверять исходищие звонки!');
  const idsLead = (await getGoogleSheetData('A')).flat();
  const incomingData = (await getGoogleSheetData('J')).flat();
  for (let i = 0; i < idsLead.length; i++) {
    //TODO: Заменить если что
    if (incomingData[i] !== 'Нет звонков') continue;

    const idLead = Number(idsLead[i]);
    try {
      const note = await getNotesByLead(idLead);

      if (!note) {
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
        updateGoogleField(date, i + 2),
      ]);
    } catch (err) {
      if (err instanceof Error) await ctx.reply(`Ошибка: ${err.message}`);
    } finally {
      i++;
    }
  }
  await ctx.reply('Готово!');
};

export const createReportTimeToday = async (ctx: Context | null) => {
  if (!ctx) return;
  await ctx.reply('Начинаю создавать таблицу');
  try {
    const pipelinesResponse = await getAllPipelines();
    await ctx.reply('Нашел данные о воронке');
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
    const today = new Date();

    const startOfDay = new Date(today);
    const endOfDay = new Date(today);

    startOfDay.setHours(0, 0, 0, 0);
    endOfDay.setHours(23, 59, 59, 999);

    // Конвертируем в Unix timestamp (секунды)
    const startTimestamp = Math.floor(startOfDay.getTime() / 1000);
    const endTimestamp = Math.floor(endOfDay.getTime() / 1000);

    const response = await getLeadToday(startTimestamp, endTimestamp);
    await ctx.reply('Собрал все сделки за сегодняшний день');
    const leads = response;

    if (!leads || leads.length === 0) {
      throw new Error('No leads found for the given filter.');
    }
    let dateIncomingCallArr: string[] = [];
    await ctx.reply('Береу звонки из сделки');
    for (let i = 0; i < leads.length; i++) {
      const idLead = leads[i].id;
      try {
        const note = await getNotesByLead(idLead);

        if (!note) {
          dateIncomingCallArr.push('Сделка звершена');
          continue;
        }
        const outgoingCalls = note
          .filter((el) => el.note_type === 'call_out')
          .sort((a, b) => a.created_at - b.created_at);

        if (outgoingCalls.length === 0) {
          dateIncomingCallArr.push('Нет звонков');
          continue;
          // throw new Error(`Для сделки ${idLead} исходящих звонков не найдено`);
        }

        const firstCall = outgoingCalls[0]; // Берем самый первый звонок
        const date = getDate(firstCall.created_at);
        dateIncomingCallArr.push(date);
        await updateLeadDateCall(idLead, date);
      } catch (err) {
        if (err instanceof Error) await ctx.reply(`Ошибка: ${err.message}`);
      }
    }
    await ctx.reply('Закончил со звонками');
    console.log(dateIncomingCallArr);

    // Преобразование данных для загрузки в Google Sheets
    const googleSheetsData = leads.map((lead, index) => {
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
        dateIncomingCallArr[index],
      ];
    });
    //TODO: не уверен что нужно каждый раз создавать заголовки
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
          'Дата исходящего звонка',
        ],
        ...googleSheetsData,
      ],
    };
    await ctx.reply('Добавляю в таблицу');
    await createGoogleFields(resource);
    await ctx.reply('Все готово!');
  } catch (error) {
    if (error instanceof Error) console.log('error' + error.message);
  }
};
