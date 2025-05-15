import { Context } from 'grammy';
import {
  domain,
  getAllPipelines,
  getContactsByIdLead,
  getLeadToday,
  getNotesByIdContact,
  getNotesByLead,
  updateLeadDateCall,
} from '../services/apiAmo';
import {
  createGoogleFields,
  getGoogleSheetData,
  updateGoogleField,
} from '../services/apiGoogleTable';
import { getDate, getPeriodTimestamps } from '../helper';

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

//Заполняю звонки за прошлые периоды если их небыло раньше
export const updateIncomingCall = async (ctx: Context | null) => {
  if (!ctx) return;
  try {
    await ctx.reply('Начинаем проверять исходищие звонки!');
    const idsLead = (await getGoogleSheetData('A')).flat();
    const incomingData = (await getGoogleSheetData('J')).flat();

    for (let i = 0; i < idsLead.length; i++) {
      //TODO: Заменить если что
      if (incomingData[i] !== 'Мы не ответили') continue;

      const idLead = Number(idsLead[i]);
      await processIncomingCallOrMessage({
        idLead: idLead,
        index: i,
      });
    }
  } catch (err) {
    if (err instanceof Error) await console.log(`Ошибка: ${err.message}`);
  }

  await ctx.reply('Готово!');
};
//

//новые поля
function getFieldValue(fields: any[], fieldName: string): string | null {
  const field = fields.find((f) => f.field_name === fieldName);
  return field?.values?.[0]?.value || null;
}

//// Форматирует дату в "YYYY.MM.DD HH:MM" (например, "2025.04.22 15:30")
function formatDate(value: string | number | null): string {
  if (!value) return '';

  const date = new Date(Number(value) * 1000);
  if (isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}.${month}.${day} ${hours}:${minutes}`;
}

export const showReportLeadByYesterday = async (
  ctx: Context,
  startDate: string,
  endDate?: string,
) => {
  let timeDate: number[];

  if (endDate) {
    timeDate = getPeriodTimestamps(startDate, endDate);
  } else {
    timeDate = getPeriodTimestamps(startDate);
  }
  const [startTimestamp, endTimestamp] = timeDate;

  const response = await getLeadToday(startTimestamp, endTimestamp);
  // const pipelinesResponse = await getAllPipelines();
  // return console.log(pipelinesResponse);
  const totalLeads: number = response.length;
  let countSeries = 0;
  let countIng = 0;
  let countClosed = 0;
  let notDistributed = 0;
  response.map((lead) => {
    // if (lead.pipeline_id !== 5716552) return;
    if (lead.status_id === 143) {
      countClosed++;
    }
    if (lead.status_id === 50238949 || lead.status_id === 50238952) {
      // Новая заявка или взято в работу
      notDistributed++;
    }
    if (!lead.custom_fields_values) return;
    lead.custom_fields_values.map((el) => {
      if (el.field_id === 606679) {
        // Если поле серии заполнено
        countSeries++;
      }
      if (el.field_id === 606681) {
        countIng++;
      }
    });
  });

  const period = !endDate ? 'вчера' : `период: ${startDate}-${endDate}`;

  const periodOutput = `Отчет за ${period}`;
  await ctx.reply(
    `${periodOutput}
Всего сделок: <b>${totalLeads}</b>
Не распределено: <b>${notDistributed}</b>
Серия: <b>${countSeries}</b>
Инжиниринг: <b>${countIng}</b>  
Закрыто и нереализовано: <b>${countClosed}</b>`,
    {
      parse_mode: 'HTML',
    },
  );
};

export const showReportLeadByPeriod = async (
  ctx: Context,
  startDate: string,
  endDate?: string,
) => {
  let timeDate: number[];

  if (endDate) {
    timeDate = getPeriodTimestamps(startDate, endDate);
  } else {
    timeDate = getPeriodTimestamps(startDate);
  }
  const [startTimestamp, endTimestamp] = timeDate;

  const response = await getLeadToday(startTimestamp, endTimestamp);
  // const pipelinesResponse = await getAllPipelines();
  // return console.log(pipelinesResponse);
  const totalLeads: number = response.length;
  let countSeries = 0;
  let countIng = 0;
  let countClosed = 0;
  let notDistributed = 0;
  response.map((lead) => {
    // if (lead.pipeline_id !== 5716552) return;
    if (lead.status_id === 143) {
      countClosed++;
    }
    if (lead.status_id === 50238949 || lead.status_id === 50238952) {
      // Новая заявка или взято в работу
      notDistributed++;
    }
    if (!lead.custom_fields_values) return;
    lead.custom_fields_values.map((el) => {
      if (el.field_id === 606679) {
        // Если поле серии заполнено
        countSeries++;
      }
      if (el.field_id === 606681) {
        countIng++;
      }
    });
  });

  const period = !endDate ? 'сегодня' : `период: ${startDate}-${endDate}`;

  const periodOutput = `Отчет за ${period}`;
  await ctx.reply(
    `${periodOutput}
Всего сделок: <b>${totalLeads}</b>
Не распределено: <b>${notDistributed}</b>
Серия: <b>${countSeries}</b>
Инжиниринг: <b>${countIng}</b>  
Закрыто и нереализовано: <b>${countClosed}</b>`,
    {
      parse_mode: 'HTML',
    },
  );
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
    // const startTimestamp = Math.floor(startOfDay.getTime() / 1000);
    // const endTimestamp = Math.floor(endOfDay.getTime() / 1000);
    const startDate = new Date('2025-05-01T00:00:00');
    const endDate = new Date('2025-05-12T23:59:59');
    const startTimestamp = Math.floor(startDate.getTime() / 1000);
    const endTimestamp = Math.floor(endDate.getTime() / 1000);

    const response = await getLeadToday(startTimestamp, endTimestamp);

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
      const newLeadSourse = getFieldValue(fields, 'Источник лида') || '';
      const newLeadTime = formatDate(
        getFieldValue(fields, 'Дата/время новая заявка'),
      );
      const newLeadAdmin = getFieldValue(fields, 'ОМ Новая заявка') || '';

      const omTakenAt = formatDate(
        getFieldValue(fields, 'Дата/время взято в работу'),
      ); // Форматируем сразу
      const omTakenBy = getFieldValue(fields, 'ОМ Взято в работу') || '';

      const omAssignedAt = formatDate(
        getFieldValue(fields, 'Время ОМ квал серия'),
      );
      const omAssignedBy = getFieldValue(fields, 'ОМ Квал серия') || '';
      const omTakenByIng = getFieldValue(fields, 'ОМ Квал инж') || '';
      const omRaspredByIng = getFieldValue(fields, 'Распр ОМ квал ИНЖ') || '';
      const omRaspredByIngTime = formatDate(
        getFieldValue(fields, 'Время Распр ОМ квал ИНЖ'),
      );
      const omTakeIng = formatDate(
        getFieldValue(fields, 'Дата/время КВАЛ инж'),
      );

      // Конвертирует разницу в миллисекундах в "HH:MM"
      function formatDiff(ms: number): string {
        if (ms <= 0) return '00:00';

        const totalMinutes = Math.floor(ms / (1000 * 60));
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      }
      //

      //Вычисляю разницу во времени между датами создания и распределения на рук-отдела серии и распр на инж - распр на рук отдела серии
      // Парсит дату из строки формата "YYYY.MM.DD HH:MM"
      function parseCustomDate(dateStr: string): Date | null {
        if (!dateStr) return null;

        // Разбиваем строку "2025.04.22 15:30" на части
        const [datePart, timePart] = dateStr.split(' ');
        if (!datePart || !timePart) return null;

        const [year, month, day] = datePart.split('.').map(Number);
        const [hours, minutes] = timePart.split(':').map(Number);

        // Проверяем валидность данных
        if (
          isNaN(year) ||
          isNaN(month) ||
          isNaN(day) ||
          isNaN(hours) ||
          isNaN(minutes)
        ) {
          return null;
        }

        return new Date(year, month - 1, day, hours, minutes);
      }
      // Безопасный парс даты из строки
      function safeParseDate(str: string | null): Date | null {
        if (!str) return null;
        return parseCustomDate(str);
      }

      // Берем нужные даты
      const createdDate = new Date(lead.created_at * 1000);
      const createdAtFormatted = formatDate(lead.created_at); // "2025.04.22 15:30"
      const takenDate = omTakenAt ? parseCustomDate(omTakenAt) : null; // Парсим обратно, если нужно
      const takeIngDate = omTakeIng ? parseCustomDate(omTakeIng) : null;
      const assignedDate = omAssignedAt ? parseCustomDate(omAssignedAt) : null;

      // Вычисляем разницу
      let diffCreatedToTaken = '';
      if (takenDate && !isNaN(takenDate.getTime())) {
        const diffMs = takenDate.getTime() - createdDate.getTime();
        diffCreatedToTaken = formatDiff(diffMs);
      }

      let diffTakenToTakeIng = '';
      if (
        takenDate &&
        takeIngDate &&
        !isNaN(takenDate.getTime()) &&
        !isNaN(takeIngDate.getTime())
      ) {
        const diffMs = takeIngDate.getTime() - takenDate.getTime();

        diffTakenToTakeIng = formatDiff(diffMs);
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
        diffAssignedToTaken = formatDiff(diffMs);
      }

      // Разница между распределением на инженера и тем, когда рук отдела взял в работу
      let diffIngRukManeger = '';
      const raspredIngDate = omRaspredByIngTime
        ? parseCustomDate(omRaspredByIngTime)
        : null;
      const takeIngDateForDiff = omTakeIng ? parseCustomDate(omTakeIng) : null;

      if (
        raspredIngDate &&
        takeIngDateForDiff &&
        !isNaN(raspredIngDate.getTime()) &&
        !isNaN(takeIngDateForDiff.getTime())
      ) {
        const diffMs = takeIngDateForDiff.getTime() - raspredIngDate.getTime();
        diffIngRukManeger = formatDiff(diffMs);
      }

      // Вычисляем разницу времени первого каcания менеджера
      let deltaTimeFirstResponse = '';
      //Получаем дату первого касания
      const incomingDate = safeParseDate(dateIncomingCallArr[index]);
      const assignedAtDate = omAssignedAt
        ? parseCustomDate(omAssignedAt)
        : null;
      const raspredIngAtDate = omRaspredByIngTime
        ? parseCustomDate(omRaspredByIngTime)
        : null;

      let timeAllWork = '-';
      const dateSaveCreatedAt = safeParseDate(createdAtFormatted);

      if (incomingDate) {
        if (omAssignedBy && assignedAtDate) {
          const diffMs = incomingDate.getTime() - assignedAtDate.getTime();
          deltaTimeFirstResponse = formatDiff(diffMs);
        } else if (!omAssignedBy && raspredIngAtDate) {
          const diffMs = incomingDate.getTime() - raspredIngAtDate.getTime();
          deltaTimeFirstResponse = formatDiff(diffMs);
        }
        if (dateSaveCreatedAt) {
          timeAllWork = formatDiff(
            incomingDate.getTime() - dateSaveCreatedAt.getTime(),
          );
        }
      }

      return [
        lead.name, // 1
        `https://${domain}.amocrm.ru/leads/detail/${lead.id}`, // 2 Ссылка на лид
        newLeadSourse, // 3 Источник сделки
        createdAtFormatted, // 4 Создан
        omTakenAt, // 5 ДатаВремя "ОМ Взято в работу"
        diffCreatedToTaken, // 6 Взято в работу - Создание ВРЕМЯ
        omTakenBy, // 7 Менеджер "ОМ Взято в работу"
        omAssignedAt, // 8 ДатаВремя "Время ОМ квал серия"
        diffAssignedToTaken, // 9 На серию - Взято в работу  ВРЕМЯ
        omAssignedBy, // 10 Менеджер "ОМ Квал серия"
        omTakeIng, // 11 На инжиниринг
        diffTakenToTakeIng, //12 На инж - Взято в работу
        omTakenByIng, // 13 РОтдела "ОМ Квал ИНЖ"
        omRaspredByIngTime, // 15 Время распределения на менеджера "Время Распр ОМ квал ИНЖ"
        diffIngRukManeger, // Дельта распредления рук отдела на менеджера
        omRaspredByIng, // 14 Распределен на менеджера "Распр ОМ квал ИНЖ"
        dateIncomingCallArr[index], // 16 Реакция менеджера на лид
        deltaTimeFirstResponse, // 17 Дельта времени первого качания менеджера
        timeAllWork,
        // lead.price,
        // lead.status_id, // ID статуса
        // statusName, // Название статуса
        // pipelineName, // Название воронки
        // lead.id, // ID
        // newLeadAdmin, // ответственный в сделке
        // newLeadTime, // Время сделка Создана на этапе Новая заявка
        // new Date(lead.updated_at * 1000).toLocaleString(),
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
          '',
          new Date().toLocaleString('ru-RU'),
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
