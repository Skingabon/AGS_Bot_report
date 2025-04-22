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

export const incomingMessageDate = async (idLead: number) => {
  const res = await getContactsByIdLead(idLead);
  const contactId = res[0].to_entity_id;
  const noteContact = await getNotesByIdContact(contactId);

  const incomingMessages = noteContact
    .filter((el) => !el.params.income)
    .sort((a, b) => a.created_at - b.created_at);
  if (!incomingMessages.length) return null; // Нет ни писем, ни звонков

  const firstMessage = incomingMessages[0];
  if (!firstMessage) return null;

  const date = getDate(firstMessage.created_at);

  return date;
};

const incomingCallDate = async (idLead: number) => {
  const notes = await getNotesByLead(idLead);
  if (!notes || notes.length === 0) return null;

  const outgoingCalls = notes
    .filter((el) => el.note_type === 'call_out')
    .sort((a, b) => a.created_at - b.created_at);

  const firstCall = outgoingCalls[0];
  if (!firstCall) return null;

  const date = getDate(firstCall.created_at);

  return date;
};

async function processIncomingCallOrMessage({
  idLead,
  index = null,
}: {
  idLead: number;
  index?: number | null;
}): Promise<string | null> {
  let date = await incomingCallDate(idLead);

  if (!date) {
    date = await incomingMessageDate(idLead);
  }

  if (!date) {
    date = 'Мы не ответили';
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
    if (incomingData[i] !== 'Мы не ответили') continue;

    const idLead = Number(idsLead[i]);
    try {
      await processIncomingCallOrMessage({
        idLead: idLead,
        index: i,
      });
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
    // const startTimestamp = Math.floor(startOfDay.getTime() / 1000);
    // const endTimestamp = Math.floor(endOfDay.getTime() / 1000);
    const startDate = new Date('2025-04-03T00:00:00');
    const endDate = new Date('2025-04-22T23:59:59');
    const startTimestamp = Math.floor(startDate.getTime() / 1000);
    const endTimestamp = Math.floor(endDate.getTime() / 1000);

    const response = await getLeadToday(startTimestamp, endTimestamp);
    console.log(response);
    await ctx.reply('Собрал все сделки за сегодняшний день');

    const leads = response;
    if (!leads || leads.length === 0) {
      throw new Error('No leads found for the given filter.');
    }

    let dateIncomingCallArr: string[] = [];

    await ctx.reply('Беру звонки и сообщения из сделки');
    for (let i = 0; i < leads.length; i++) {
      const idLead = leads[i].id;
      try {
        const date = await processIncomingCallOrMessage({
          idLead: idLead,
        });
        dateIncomingCallArr.push(date || '*');
      } catch (err) {
        dateIncomingCallArr.push('-');
        if (err instanceof Error) await console.log(`Ошибка: ${err.message}`);
      }
    }
    await ctx.reply('Закончил с "первым контактом"');
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

      const omTakeIng = formatDate(
        getFieldValue(fields, 'Дата/время КВАЛ инж'),
      );

      //Вычисляю разницу во времени между датами создания и распределения на рук-отдела серии и распр на инж - распр на рук отдела серии
      function parseCustomDate(dateStr: string): Date | null {
        const [datePart, timePart] = dateStr.split(', ');
        if (!datePart || !timePart) return null;

        const [day, month, year] = datePart.split('.').map(Number);
        const [hours, minutes, seconds] = timePart.split(':').map(Number);

        return new Date(year, month - 1, day, hours, minutes, seconds);
      }
      const createdDate = new Date(lead.created_at * 1000);
      const takenDate = omTakenAt ? parseCustomDate(omTakenAt) : null;
      const takeIngDate = omTakeIng ? parseCustomDate(omTakeIng) : null;
      const assignedDate = omAssignedAt ? parseCustomDate(omAssignedAt) : null;

      let diffCreatedToTaken = '';
      if (takenDate && !isNaN(takenDate.getTime())) {
        const diffMs = takenDate.getTime() - createdDate.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs / (1000 * 60)) % 60);
        diffCreatedToTaken = `${diffHours} ч ${diffMinutes} мин`;
      } else {
        diffCreatedToTaken = '';
      }

      let diffTakenToTakeIng = '';
      if (
        takenDate &&
        takeIngDate &&
        !isNaN(takenDate.getTime()) &&
        !isNaN(takeIngDate.getTime())
      ) {
        const diffMs = takeIngDate.getTime() - takenDate.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs / (1000 * 60)) % 60);
        diffTakenToTakeIng = `${diffHours} ч ${diffMinutes} мин`;
      } else {
        diffTakenToTakeIng = '';
      }

      let diffAssignedToTaken = '';
      if (
        takenDate &&
        assignedDate &&
        !isNaN(takenDate.getTime()) &&
        !isNaN(assignedDate.getTime())
      ) {
        const diffMs = assignedDate.getTime() - takenDate.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs / (1000 * 60)) % 60);
        diffAssignedToTaken = `${diffHours} ч ${diffMinutes} мин`;
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
        dateIncomingCallArr[index], //Реакция менеджера на лид
        omTakenAt, //ДатаВремя "ОМ Взято в работу"
        diffCreatedToTaken, // Взято в работу - Создание
        omTakenBy, //Менеджер "ОМ Взято в работу"
        omAssignedAt, //ДатаВремя "Время ОМ квал серия"
        omAssignedBy, //Менеджер "ОМ Квал серия"
        diffAssignedToTaken, //На серию - Взято в работу
        omTakeIng, //На инжиниринг
        diffTakenToTakeIng, //На инж - Взято в работу
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
    if (error instanceof Error) {
      await ctx.reply('Бот остановлен. Скорее всего сделок нет');

      console.log('error' + error.message);
    }
  }
};
