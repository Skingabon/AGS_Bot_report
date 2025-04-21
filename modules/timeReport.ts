import { Context } from 'grammy';
import {
  createGoogleFields,
  domain,
  getAllPipelines,
  getContactsByIdLead,
  getGoogleSheetData,
  getLeadToday,
  getNotesByIdContact,
  getNotesByLead,
  updateGoogleField,
  updateLeadDateCall,
} from '../api';
import { getDate } from '../helper';

export const processIncomingMessage = async (idLead: number) => {
  const res = await getContactsByIdLead(idLead);
  const contactId = res[0].to_entity_id;

  const noteContact = await getNotesByIdContact(contactId);

  const incomingMessages = noteContact
    .filter((el) => !el.params.income)
    .sort((a, b) => a.created_at - b.created_at);
  if (!incomingMessages.length) return 'Нет исходящих писем';

  const firstMessage = incomingMessages[0];
  const date = getDate(firstMessage.created_at);

  return date;
};

async function processIncomingCallOrMessage(
  idLead: number,
  index: number | null = null, // null, если не нужно обновлять Google Sheet
): Promise<string | null> {
  const notes = await getNotesByLead(idLead);
  if (!notes || notes.length === 0) return 'Мы не ответили';

  const outgoingCalls = notes
    .filter((el) => el.note_type === 'call_out')
    .sort((a, b) => a.created_at - b.created_at);

  let date = '';
  if (outgoingCalls.length === 0) {
    date = await processIncomingMessage(idLead);
  } else {
    const firstCall = outgoingCalls[0];
    date = getDate(firstCall.created_at);
  }

  await updateLeadDateCall(idLead, date);

  if (index !== null) {
    await updateGoogleField(date, index + 2);
  }

  return date;
}

export const updateIncomingCall = async (ctx: Context | null) => {
  if (!ctx) return;
  await ctx.reply('Начинаем проверять исходищие звонки!');
  const idsLead = (await getGoogleSheetData('A')).flat();
  const incomingData = (await getGoogleSheetData('J')).flat();

  for (let i = 0; i < idsLead.length; i++) {
    //TODO: Заменить если что
    if (
      incomingData[i] !== 'Нет звонков' ||
      incomingData[i] !== 'Мы не ответили'
    )
      continue;

    const idLead = Number(idsLead[i]);
    try {
      await processIncomingCallOrMessage(idLead, i);
    } catch (err) {
      if (err instanceof Error) await console.log(`Ошибка: ${err.message}`);
    }
  }
  await ctx.reply('Готово!');
};

//новые поля
function getFieldValue(fields: any[], fieldName: string): string | null {
  const field = fields.find((f) => f.field_name === fieldName);
  return field?.values?.[0]?.value || null;
}

function formatDate(value: string | number | null): string {
  if (!value) return '';
  return new Date(Number(value) * 1000).toLocaleString('ru-RU');
}
//

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

    await ctx.reply('Беру звонки из сделки');
    for (let i = 0; i < leads.length; i++) {
      const idLead = leads[i].id;
      try {
        const date = await processIncomingCallOrMessage(idLead);
        dateIncomingCallArr.push(date || '*');
      } catch (err) {
        dateIncomingCallArr.push('-');
        if (err instanceof Error) await console.log(`Ошибка: ${err.message}`);
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

      //новые поля
      const fields = lead.custom_fields_values || [];

      const omTakenAt = formatDate(
        getFieldValue(fields, 'Дата/время взято в работу'),
      );
      const omTakenBy = getFieldValue(fields, 'ОМ Взято в работу') || '';

      const omAssignedAt = formatDate(
        getFieldValue(fields, 'Время ОМ квал серия'),
      );
      const omAssignedBy = getFieldValue(fields, 'ОМ Квал серия') || '';
      //
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
        omTakenAt,
        omTakenBy,
        omAssignedAt,
        omAssignedBy,
      ];
    });
    //TODO: не уверен что нужно каждый раз создавать заголовки
    const resource = {
      values: [
        [
          '',
          '',
          '',
          '',
          '',
          '',
          new Date().toLocaleString('ru-RU'),
          '',
          '',
          '',
          '',
          '',
          '',
          '',
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
