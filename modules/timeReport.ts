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
  updateFieldsGooglePack,
} from '../services/apiGoogleTable';
import {
  formatDate,
  formatDiff,
  getCurrentTime,
  getDate,
  getFieldValue,
  getPeriodTimestamps,
  parseCustomDate,
  safeParseDate,
} from '../helper';
import { isCallNote, isMessageNote, Lead } from '../interfaces';
import { getParamsLead, getStatusLead } from './updateFields';

type communicationType = { source: string; time: number };

export const incomingActionDateFromContact = async (
  idLead: number,
  leadCreateDate: number,
): Promise<null | communicationType> => {
  try {
    const res = await getContactsByIdLead(idLead);
    const contactId = res[0].to_entity_id;
    const noteContact = await getNotesByIdContact(contactId);
    let communicationsDate: communicationType[] = [];

    noteContact.map((el) => {
      // Берем сделки, где звонки не старше самой сделки
      if (el.created_at < leadCreateDate) return;
      if (isMessageNote(el)) {
        if (!el.params.income) {
          communicationsDate.push({
            source: 'Сбщ',
            time: el.params.delivery.time,
          });
        }
      }
      if (isCallNote(el)) {
        //call_status === 4 значит звонок состоялся
        if (el.note_type === 'call_out' && el.params.call_status === 4) {
          communicationsDate.push({
            source: 'Звонок',
            time: el.created_at,
          });
        }
      }
    });
    if (!communicationsDate.length) {
      return null;
    }

    communicationsDate.sort((a, b) => a.time - b.time);
    // if (!incomingMessages) return null; // Нет писем

    const firstMessageDate = communicationsDate[0];
    if (!firstMessageDate) return null;

    return firstMessageDate;
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Глобальная ошибка: ${err.message}`);
    }
    return null;
  }
};

const incomingCallDate = async (
  idLead: number,
): Promise<null | communicationType> => {
  try {
    const notes = await getNotesByLead(idLead);
    if (!notes || notes.length === 0) return null;

    const outgoingCalls = notes
      .filter((el) => el.note_type === 'call_out')
      .sort((a, b) => a.created_at - b.created_at);

    const firstCall = outgoingCalls[0];
    if (!firstCall) return null;

    const date = firstCall.created_at;

    return { source: 'Звонок', time: date };
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Глобальная ошибка: ${err.message}`);
    }
    return null;
  }
};

async function getCreatedAtIncomingCallOrMessage(
  lead: Lead,
): Promise<communicationType | null> {
  let incomingAction = await incomingActionDateFromContact(
    lead.id,
    lead.created_at,
  );
  if (!incomingAction?.time) {
    incomingAction = await incomingCallDate(lead.id);
  }

  return incomingAction;
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
    await ctx.reply(`Начинаем проверять исходящие звонки! ${getCurrentTime()}`);

    // Получаем данные из таблицы
    const idsLead = (await getGoogleSheetData('A')).flat();

    // Подготавливаем данные для пакетного обновления
    const sheetUpdates: {
      range: string;
      values: (string | number)[][];
    }[] = [];

    const amoUpdatesPromises: Promise<void>[] = [];
    const batchSize = 50; // Размер пакета для обработки
    let processedCount = 0;

    // Обрабатываем лиды пакетами
    for (let i = 0; i < idsLead.length; i += batchSize) {
      const batch = idsLead.slice(i, i + batchSize);

      // Обрабатываем текущий пакет
      for (let j = 0; j < batch.length; j++) {
        const idx = i + j;
        const rowNumber = idx + 2; // +2 для учета заголовка

        try {
          const idLead = Number(batch[j]);
          const lead = await getLeadById(idLead);
          const incomingAction = await getCreatedAtIncomingCallOrMessage(lead);

          if (!incomingAction) {
            sheetUpdates.push({
              range: `T${rowNumber}:V${rowNumber}`,
              values: [['Мы не ответили', '-', '-']],
            });
            continue;
          }

          if (
            isInvalidDateIncoming({
              createAtLead: lead.created_at,
              createAtIncoming: incomingAction.time,
            })
          ) {
            sheetUpdates.push({
              range: `T${rowNumber}:V${rowNumber}`,
              values: [['Старый лид', '-', '-']],
            });
            continue;
          }

          // Обработка данных
          const fields = lead.custom_fields_values || [];
          let timeAllWork = '-';
          const createdAtFormatted = formatDate(lead.created_at);
          const dateSaveCreatedAt = safeParseDate(createdAtFormatted);
          const incomingDate = safeParseDate(getDate(incomingAction.time));

          if (incomingDate && dateSaveCreatedAt) {
            timeAllWork = formatDiff(
              incomingDate.getTime() - dateSaveCreatedAt.getTime(),
            );
          }

          let deltaTimeFirstResponse = '';
          const omAssignedAt = formatDate(
            getFieldValue(fields, 'Время ОМ квал серия'),
          );
          const omRaspredByIngTime = formatDate(
            getFieldValue(fields, 'Время Распр ОМ квал ИНЖ'),
          );

          const assignedAtDate = omAssignedAt
            ? parseCustomDate(omAssignedAt)
            : null;
          const raspredIngAtDate = omRaspredByIngTime
            ? parseCustomDate(omRaspredByIngTime)
            : null;
          const omAssignedBy = getFieldValue(fields, 'ОМ Квал серия') || '';

          if (incomingDate) {
            if (omAssignedBy && assignedAtDate) {
              deltaTimeFirstResponse = formatDiff(
                incomingDate.getTime() - assignedAtDate.getTime(),
              );
            } else if (!omAssignedBy && raspredIngAtDate) {
              deltaTimeFirstResponse = formatDiff(
                incomingDate.getTime() - raspredIngAtDate.getTime(),
              );
            }
          }

          // Добавляем обновления
          sheetUpdates.push({
            range: `T${rowNumber}:V${rowNumber}`,
            values: [
              [
                `${getDate(incomingAction.time)} / ${incomingAction.source}`,
                deltaTimeFirstResponse,
                timeAllWork,
              ],
            ],
          });

          // Добавляем обновление в AMO
          amoUpdatesPromises.push(
            updateLeadDateCall(idLead, getDate(incomingAction.time)),
          );

          processedCount++;

          // // Отправляем промежуточный отчет каждые 100 обработанных лидов
          // if (processedCount % 100 === 0) {
          //   await ctx.reply(
          //     `Доб ${processedCount} из ${idsLead.length} лидов...`,
          //   );
          // }
        } catch (err) {
          const rowNumber = idx + 2;
          sheetUpdates.push({
            range: `T${rowNumber}:V${rowNumber}`,
            values: [['Ошибка обработки', '-', '-']],
          });
          if (err instanceof Error) {
            console.log(
              `Ошибка при обработке лида ${batch[j]}: ${err.message}`,
            );
          }
        }
      }

      // Пакетное обновление Google Sheets для текущего пакета
      if (sheetUpdates.length > 0) {
        await updateFieldsGooglePack(sheetUpdates);
        sheetUpdates.length = 0; // Очищаем массив после обновления
      }
    }

    // Обновляем данные в AMO пакетно
    await Promise.all(amoUpdatesPromises);

    await ctx.reply(
      `Готово! Обработано ${processedCount} лидов. ${getCurrentTime()}`,
    );
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Глобальная ошибка: ${err.message}`);
      await ctx.reply(`Произошла ошибка: ${err.message}`);
    }
  }
};

export const updateAllFiled = async (ctx: Context | null) => {
  if (!ctx) return;
  try {
    await ctx.reply('Заполняю основные поля');
    const idsLead = (await getGoogleSheetData('A')).flat();

    // Подготавливаем данные для пакетного обновления
    const sheetUpdates: {
      range: string;
      values: (string | number)[][];
    }[] = [];

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

    const batchSize = 50; // Размер пакета для обработки
    let processedCount = 0;

    // Обрабатываем лиды пакетами
    for (let i = 0; i < idsLead.length; i += batchSize) {
      const batch = idsLead.slice(i, i + batchSize);

      // Обрабатываем текущий пакет
      for (let j = 0; j < batch.length; j++) {
        const idx = i + j;
        const rowNumber = idx + 2; // +2 для учета заголовка

        try {
          const idLead = Number(batch[j]);
          const lead = await getLeadById(idLead);
          const {
            statusName,
            pipelineName,
            createdAtFormatted,
            omTakenAt,
            diffCreatedToTaken,
            omTakenBy,
            omAssignedAt,
            diffAssignedToTaken,
            omAssignedBy,
            omTakeIng,
            diffTakenToTakeIng,
            omTakenByIng,
            omRaspredByIngTime,
            diffIngRukManeger,
            omRaspredByIng,
            reasonForRefusal,
            formattedUpdatedAt,
          } = getParamsLead({ lead, pipelinesMap });

          // Добавляем обновления
          sheetUpdates.push({
            range: `E${rowNumber}:S${rowNumber}`,
            values: [
              [
                statusName,
                pipelineName,
                createdAtFormatted,
                omTakenAt,
                diffCreatedToTaken,
                omTakenBy,
                omAssignedAt,
                diffAssignedToTaken,
                omAssignedBy,
                omTakeIng,
                diffTakenToTakeIng,
                omTakenByIng,
                omRaspredByIngTime,
                diffIngRukManeger,
                omRaspredByIng,
              ],
            ],
          });
          sheetUpdates.push({
            range: `W${rowNumber}:Y${rowNumber}`,
            values: [[formattedUpdatedAt, reasonForRefusal, lead.price]],
          });

          processedCount++;
        } catch (err) {
          if (err instanceof Error) {
            console.log(
              `Ошибка при обработке лида ${batch[j]}: ${err.message}`,
            );
          }
        }
      }

      // Пакетное обновление Google Sheets для текущего пакета
      if (sheetUpdates.length > 0) {
        await updateFieldsGooglePack(sheetUpdates);
        sheetUpdates.length = 0; // Очищаем массив после обновления
      }
    }

    // Обновляем данные в AMO пакетно
    await ctx.reply(
      `Готово! Обработано ${processedCount} лидов. ${getCurrentTime()}`,
    );
  } catch (error) {
    if (error instanceof Error) {
      await ctx.reply('Бот остановлен. Скорее всего сделок нет');

      console.log('error' + error.message);
    }
  }
};

export const showReportLeadByYesterday = async (
  ctx: Context,
  startDate: string,
  endDate?: string,
) => {
  try {
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
  } catch (error) {
    if (error instanceof Error) {
      await ctx.reply('Бот остановлен. Скорее всего сделок нет');

      console.log('error' + error.message);
    }
  }
};

export const showReportLeadByPeriod = async (
  ctx: Context,
  startDate: string,
  endDate?: string,
) => {
  try {
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
  } catch (error) {
    if (error instanceof Error) {
      await ctx.reply('Бот остановлен. Скорее всего сделок нет');

      console.log('error' + error.message);
    }
  }
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
    const startTimestamp = Math.floor(startOfDay.getTime() / 1000); //TODO Для прода
    const endTimestamp = Math.floor(endOfDay.getTime() / 1000);

    // const startDate = new Date('2025-06-26T00:00:00');
    // const endDate = new Date('2025-06-26T23:59:59');
    // const startTimestamp = Math.floor(startDate.getTime() / 1000);
    // const endTimestamp = Math.floor(endDate.getTime() / 1000);

    const response = await getLeadToday(startTimestamp, endTimestamp);

    await ctx.reply('Собрал все сделки за сегодняшний день');

    const leads = response;
    if (!leads || leads.length === 0) {
      throw new Error('No leads found for the given filter.');
    }

    // Преобразование данных для загрузки в Google Sheets
    const googleSheetsData = leads.map((lead) => {
      const {
        newLeadSourse,
        statusName,
        pipelineName,
        createdAtFormatted,
        omTakenAt,
        diffCreatedToTaken,
        omTakenBy,
        omAssignedAt,
        diffAssignedToTaken,
        omAssignedBy,
        omTakeIng,
        diffTakenToTakeIng,
        omTakenByIng,
        omRaspredByIngTime,
        diffIngRukManeger,
        omRaspredByIng,
        formattedUpdatedAt,
        reasonForRefusal,
      } = getParamsLead({ lead, pipelinesMap });

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
        reasonForRefusal, // причина отказа
        lead.price, // бюджет
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
