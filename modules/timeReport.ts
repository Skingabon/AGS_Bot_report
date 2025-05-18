import { Context } from 'grammy';
import {
  domain,
  getAllPipelines,
  getContactsByIdLead,
  getLeadById,
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
import {
  formatDiff,
  getDate,
  getPeriodTimestamps,
  parseCustomDate,
  safeParseDate,
} from '../helper';

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

  const date = firstMessage.created_at;

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

  const date = firstCall.created_at;

  return date;
};

async function getCreatedAtIncomingCallOrMessage({
  idLead,
}: {
  idLead: number;
}): Promise<number | null> {
  let date = await incomingCallDate(idLead);

  if (!date) {
    date = await incomingMessageDate(idLead);
  }

  if (!date) {
    date = 0;
  }

  return date;
}

function isInvalidDateIncoming({
  createAtLead,
  createAtIncoming,
}: {
  createAtLead: number;
  createAtIncoming: number;
}): boolean {
  return createAtLead > createAtIncoming;
}

//Заполняю звонки за прошлые периоды если их небыло раньше
export const updateIncomingCall = async (ctx: Context | null) => {
  if (!ctx) return;
  try {
    await ctx.reply('Начинаем проверять исходищие звонки!');
    const idsLead = (await getGoogleSheetData('A')).flat();
    const incomingData = (await getGoogleSheetData('T')).flat();

    for (let i = 0; i < idsLead.length; i++) {
      try {
        //TODO: Заменить если что
        if (incomingData[i] === 'Мы не ответили') continue;

        const idLead = Number(idsLead[i]);
        const lead = await getLeadById(idLead);
        const date = await getCreatedAtIncomingCallOrMessage({
          idLead,
        });

        if (!date) {
          await updateLeadDateCall(idLead, 'Мы не ответили');
          await updateGoogleField('Мы не ответили', i + 2);
          continue;
        }

        if (
          isInvalidDateIncoming({
            createAtLead: lead.created_at,
            createAtIncoming: date,
          })
        ) {
          await updateLeadDateCall(idLead, 'Мы не ответили');
          await updateGoogleField('Мы не ответили', i + 2);

          continue;
        }
        const fields = lead.custom_fields_values || [];
        let timeAllWork = '-';
        const createdAtFormatted = formatDate(lead.created_at);
        const dateSaveCreatedAt = safeParseDate(createdAtFormatted);
        const incomingDate = safeParseDate(getDate(date));

        if (incomingDate) {
          if (dateSaveCreatedAt) {
            timeAllWork = formatDiff(
              incomingDate.getTime() - dateSaveCreatedAt.getTime(),
            );
          }
        }

        let deltaTimeFirstResponse = '';
        const omAssignedAt = formatDate(
          getFieldValue(fields, 'Время ОМ квал серия'),
        );
        const omRaspredByIngTime = formatDate(
          getFieldValue(fields, 'Время Распр ОМ квал ИНЖ'),
        );
        //Получаем дату первого касания
        const assignedAtDate = omAssignedAt
          ? parseCustomDate(omAssignedAt)
          : null;
        const raspredIngAtDate = omRaspredByIngTime
          ? parseCustomDate(omRaspredByIngTime)
          : null;
        const omAssignedBy = getFieldValue(fields, 'ОМ Квал серия') || '';

        if (incomingDate) {
          if (omAssignedBy && assignedAtDate) {
            const diffMs = incomingDate.getTime() - assignedAtDate.getTime();
            deltaTimeFirstResponse = formatDiff(diffMs);
          } else if (!omAssignedBy && raspredIngAtDate) {
            const diffMs = incomingDate.getTime() - raspredIngAtDate.getTime();
            deltaTimeFirstResponse = formatDiff(diffMs);
          }
        }

        const promises = Promise.all([
          updateLeadDateCall(idLead, getDate(date)),
          updateGoogleField(getDate(date), i + 2),
          updateGoogleField(timeAllWork, i + 2, 'V'),
          updateGoogleField(deltaTimeFirstResponse, i + 2, 'U'),
        ]);
        await promises;
      } catch (err) {
        if (err instanceof Error) console.log(`Ошибка: ${err.message}`);
      }
    }
  } catch (err) {
    if (err instanceof Error) console.log(`Ошибка: ${err.message}`);
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
  const totalLeads: number = response.length;
  let countSeries = 0;
  let countIng = 0;
  let countClosed = 0;
  let notDistributed = 0;
  response.map((lead) => {
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
    // const startTimestamp = Math.floor(startOfDay.getTime() / 1000); //TODO Для прода
    // const endTimestamp = Math.floor(endOfDay.getTime() / 1000);
    const startDate = new Date('2025-05-14T00:00:00');
    const endDate = new Date('2025-05-17T23:59:59');
    const startTimestamp = Math.floor(startDate.getTime() / 1000);
    const endTimestamp = Math.floor(endDate.getTime() / 1000);

    const response = await getLeadToday(startTimestamp, endTimestamp);

    await ctx.reply('Собрал все сделки за сегодняшний день');

    const leads = response;
    if (!leads || leads.length === 0) {
      throw new Error('No leads found for the given filter.');
    }

    // let dateIncomingCallArr: string[] = [];

    await ctx.reply('Беру звонки и сообщения из сделки');
    // for (let i = 0; i < leads.length; i++) {
    //   const idLead = leads[i].id;
    //   const leadCreateDate = leads[i].created_at;
    //   try {
    //     //TODO иногда выдает дату звонка, которого не было
    //     const date = await getCreatedAtIncomingCallOrMessage({
    //       idLead: idLead,
    //     });
    //     if (!date) {
    //       dateIncomingCallArr.push('*');
    //       await updateLeadDateCall(idLead, 'Мы не ответили');
    //       continue;
    //     }
    //     if (
    //       isInvalidDateIncoming({
    //         createAtLead: leadCreateDate,
    //         createAtIncoming: date,
    //       })
    //     ) {
    //       await updateLeadDateCall(idLead, 'Мы не ответили');
    //       dateIncomingCallArr.push('Мы не ответили');
    //       continue;
    //     }
    //     await updateLeadDateCall(idLead, getDate(date));
    //     dateIncomingCallArr.push(getDate(date));
    //   } catch (err) {
    //     dateIncomingCallArr.push('-');
    //     if (err instanceof Error) console.log(`Ошибка: ${err.message}`);
    //   }
    // }
    await ctx.reply('Закончил с "первым контактом"');
    // Преобразование данных для загрузки в Google Sheets
    const googleSheetsData = leads.map((lead, index) => {
      // Получаем название воронки по ID
      const pipelineName = pipelinesMap[lead.pipeline_id] || 'Не найдено';

      // Добавляем название статуса в зависимости от ID статуса
      //Заменить на switch case
      let statusName = '';
      if (lead.status_id === 142) {
        statusName = 'Успешно реализовано';
      } else if (lead.status_id === 143) {
        statusName = 'Закрыто и не реализовано';
      }
      if (lead.status_id === 18913120) {
        statusName = 'Отдел серийного об-я';
      }
      if (lead.status_id === 73470054) {
        statusName = 'Отдел инжиниринга ';
      }

      //новые поля
      const fields = lead.custom_fields_values || [];
      const newLeadSourse = getFieldValue(fields, 'Источник лида') || '';
      // const newLeadTime = formatDate(
      //   getFieldValue(fields, 'Дата/время новая заявка'),
      // );
      // const newLeadAdmin = getFieldValue(fields, 'ОМ Новая заявка') || '';

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
      // let deltaTimeFirstResponse = '';
      // //Получаем дату первого касания
      // const incomingDate = safeParseDate(dateIncomingCallArr[index]);
      // const assignedAtDate = omAssignedAt
      //   ? parseCustomDate(omAssignedAt)
      //   : null;
      // const raspredIngAtDate = omRaspredByIngTime
      //   ? parseCustomDate(omRaspredByIngTime)
      //   : null;

      // let timeAllWork = '-';
      // const dateSaveCreatedAt = safeParseDate(createdAtFormatted);

      // if (incomingDate) {
      //   if (omAssignedBy && assignedAtDate) {
      //     const diffMs = incomingDate.getTime() - assignedAtDate.getTime();
      //     deltaTimeFirstResponse = formatDiff(diffMs);
      //   } else if (!omAssignedBy && raspredIngAtDate) {
      //     const diffMs = incomingDate.getTime() - raspredIngAtDate.getTime();
      //     deltaTimeFirstResponse = formatDiff(diffMs);
      //   }
      //   // if (dateSaveCreatedAt) {
      //   //   timeAllWork = formatDiff(
      //   //     incomingDate.getTime() - dateSaveCreatedAt.getTime(),
      //   //   );
      //   // }
      // }

      const date = new Date(lead.updated_at * 1000);
      const formattedUpdatedAt = `${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU')}`;
      // Сортирую по возрастанию даты создания
      leads.sort((a, b) => a.created_at - b.created_at);

      return [
        lead.id, // 1 A ID
        lead.name, // 2 B
        `https://${domain}.amocrm.ru/leads/detail/${lead.id}`, // 3 C Ссылка на лид
        newLeadSourse, // 4 D Источник сделки
        statusName, // 5 E Название статуса
        pipelineName, // 6 F Название воронки
        createdAtFormatted, // 7 G Создан
        omTakenAt, // 8 H ДатаВремя "ОМ Взято в работу"
        diffCreatedToTaken, // 9 I Дельта Взято в работу - Создание ВРЕМЯ
        omTakenBy, // 10 J Рук отдела Менеджер "ОМ Взято в работу"
        omAssignedAt, //11 K На серию. ДатаВремя "Время ОМ квал серия"
        diffAssignedToTaken, // 12 L Дельта На серию - Взято в работу  ВРЕМЯ
        omAssignedBy, // 13 M Менеджер Серии "ОМ Квал серия"
        omTakeIng, // 14 N Распределен на инжиниринг
        diffTakenToTakeIng, //15 O На инж - Взято в работу
        omTakenByIng, // 16 Р Кто распределил наинжиниринг "ОМ Квал ИНЖ"
        omRaspredByIngTime, // 17 Q Время распределения на менеджера инжиниринга "Время Распр ОМ квал ИНЖ"
        diffIngRukManeger, // 18 R  Дельта распредления Кто распределил на менеджера
        omRaspredByIng, // 14 S Менеджер отдела инжиниринга. Распределен на менеджера "Распр ОМ квал ИНЖ"
        '-', // Первое касание
        // dateIncomingCallArr[index], // 16 T Первое касание. Реакция менеджера на лид Первое касание
        '-', //deltaTimeFirstResponse
        // deltaTimeFirstResponse, // 17 U Дельта от распределения на серию или инжтиниринг до первого касания менеджера - звонок или письмо или отввет в мессенджере.
        '-', // timeAllWork
        // timeAllWork, // 18 V  Общее время сделки в работе от даты/время создания до даты последнего действия W
        formattedUpdatedAt, // 19 W Дата/время последнего обновления в сделке
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

    const resource = {
      values: googleSheetsData,
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
