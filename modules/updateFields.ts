import { isMessageNote, Lead } from '../interfaces';
import {
  formatDurationDDHHMM,
  formatSecondsToHHMM,
  getDate,
} from '../util/helper';
import { TimeSheetService } from '../services/apiGoogleTable';
import { AmoAPI } from '../services/apiAmo';
import { getDataStatusLead, getParamsLead } from './utils';

type requiredCommunicationType = {
  id: number;
  source: 'Письмо' | 'Звонок' | 'Примечание' | 'Вложение';
  time: number;
  core: 'contact' | 'note' | 'task';
  responsibleUserId: number;
};

type partialCommunicationType = {
  durationCall: number | null;
  text: string;
  income: boolean;
  isDoCall: boolean;
  linkCall: string;
};

export type communicationType = requiredCommunicationType &
  Partial<partialCommunicationType>;

type returnFirstTouch = {
  firstTouch: communicationType | null;
  communications: communicationType[];
};

export const incomingActionDateFromContact = async (
  idLead: number,
  leadCreateDate: number,
): Promise<returnFirstTouch> => {
  try {
    const res = await new AmoAPI().getContactsByIdLead(idLead);
    const contactId = res[0].to_entity_id;
    const noteContact = await new AmoAPI().getNotesByIdContact(contactId);
    let communications: communicationType[] = [];

    noteContact.map((el) => {
      // Берем сделки, где звонки не старше самой сделки
      if (el.created_at < leadCreateDate) return;
      if (isMessageNote(el)) {
        communications.push({
          id: el.id,
          source: 'Письмо',
          time: el.params.delivery.time,
          durationCall: null,
          text: el.params.subject,
          income: el.params.income,
          core: 'contact',
          responsibleUserId: el.responsible_user_id,
        });
      }
      // if (isCallNote(el)) {
      //call_status === 4 значит звонок состоялся
      // убрал status === 4. проверяем любые звонки
      communications.push({
        id: el.id,
        source: 'Звонок',
        time: el.created_at,
        durationCall: el.params.duration,
        income: el.note_type === 'call_in',
        isDoCall: el.params.call_status === 4,
        core: 'contact',
        linkCall: el.params.link,
        responsibleUserId: el.responsible_user_id,
      });
      // }
    });
    if (!communications.length) {
      return { firstTouch: null, communications: [] };
    }

    const sortedCommuns = [...communications]
      .filter((el) => !el.income)
      .sort((a, b) => a.time - b.time);
    // if (!incomingMessages) return null; // Нет писем

    const firstTouch = sortedCommuns[0] || null;

    return { firstTouch, communications };
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Глобальная ошибка: ${err.message}`);
    }
    return { firstTouch: null, communications: [] };
  }
};

export const incomingCallDate = async (
  idLead: number,
): Promise<returnFirstTouch> => {
  try {
    const notes = await new AmoAPI().getNotesByLead(idLead);
    if (!notes || notes.length === 0)
      return { firstTouch: null, communications: [] };

    const communications: communicationType[] = [];

    notes.map((el) => {
      if (el.note_type === 'call_out' || el.note_type === 'call_in') {
        communications.push({
          id: el.id,
          source: 'Звонок',
          time: el.created_at,
          durationCall: el.params.duration,
          income: el.note_type === 'call_in',
          isDoCall: el.params.call_status === 4,
          core: 'note',
          linkCall: el.params.link,
          responsibleUserId: el.responsible_user_id,
        });
      }
      if (el.note_type === 'amomail_message') {
        communications.push({
          id: el.id,
          source: 'Письмо',
          time: el.created_at,
          durationCall: null,
          text: el.params.subject,
          income: el.params.income,
          core: 'note',
          responsibleUserId: el.responsible_user_id,
        });
      }
      if (el.note_type === 'common') {
        communications.push({
          id: el.id,
          source: 'Примечание',
          time: el.created_at,
          text: el.params.text,
          core: 'note',
          responsibleUserId: el.responsible_user_id,
        });
      }
      if (el.note_type === 'attachment') {
        communications.push({
          id: el.id,
          source: 'Вложение',
          time: el.created_at,
          text: el.params.text,
          core: 'note',
          responsibleUserId: el.responsible_user_id,
        });
      }
    });

    if (!communications.length) {
      return { firstTouch: null, communications: [] };
    }

    const outgoingCalls = [...communications]
      .filter((el) => !el.income && el.source !== 'Примечание')
      .sort((a, b) => a.time - b.time);

    const firstTouch = outgoingCalls[0] || null;

    return { firstTouch, communications };
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Глобальная ошибка: ${err.message}`);
    }
    return { firstTouch: null, communications: [] };
  }
};

async function getCreatedAtIncomingCallOrMessage(
  lead: Lead,
): Promise<communicationType | null> {
  // Из контактов и заметок
  const [incomingFromContacts, incomingFromNotes] = await Promise.all([
    incomingActionDateFromContact(lead.id, lead.created_at),
    incomingCallDate(lead.id),
  ]);

  const firstTouchContacts = incomingFromContacts.firstTouch;
  const firstTouchNotes = incomingFromNotes.firstTouch;

  if (!firstTouchContacts && firstTouchNotes) {
    return firstTouchNotes;
  }

  if (!firstTouchNotes && firstTouchContacts) {
    return firstTouchContacts;
  }

  if (firstTouchContacts && firstTouchNotes) {
    if (firstTouchContacts.time < firstTouchNotes.time) {
      return firstTouchContacts;
    } else {
      return firstTouchNotes;
    }
  }
  return null;
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
export const updateIncomingCall = async (isAllField = false): Promise<void> => {
  const startTime = Date.now();

  try {
    const amo = new AmoAPI();
    const sheet = new TimeSheetService();

    // Получаем данные из таблицы
    const { data: allData, startRow } =
      await sheet.getDataWithRowNumbers(isAllField);

    console.log(`📊 Всего строк для обработки: ${allData.length}`);

    // НАСТРОЙКИ ДЛЯ AMOCRM API
    const AMOCRM_RATE_LIMIT = 7; // 7 запросов в секунду (у amoCRM обычно 7-10/сек)
    const BATCH_SIZE = 50; // Оптимальный размер пакета
    const DELAY_BETWEEN_BATCHES = 2000; // 2 секунды

    let processedCount = 0;
    let skippedCount = 0;
    let amoRequestsInLastSecond = 0;
    let lastRequestTime = Date.now();

    // Функция для контроля скорости запросов к amoCRM
    const rateLimitAmoCRM = async () => {
      const now = Date.now();
      const timeSinceLastRequest = now - lastRequestTime;

      // Если прошла секунда, сбрасываем счетчик
      if (timeSinceLastRequest >= 1000) {
        amoRequestsInLastSecond = 0;
        lastRequestTime = now;
      }

      // Если превысили лимит, ждем
      if (amoRequestsInLastSecond >= AMOCRM_RATE_LIMIT) {
        const waitTime = 1000 - timeSinceLastRequest + 100; // +100 мс для надежности
        if (waitTime > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          amoRequestsInLastSecond = 0;
          lastRequestTime = Date.now();
        }
      }

      amoRequestsInLastSecond++;
    };

    // Обрабатываем пакетами
    for (let i = 0; i < allData.length; i += BATCH_SIZE) {
      const batchStartTime = Date.now();
      const batch = allData.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allData.length / BATCH_SIZE);

      console.log(
        `\n🔧 Пакет ${batchNumber}/${totalBatches} (${batch.length} строк)`,
      );

      const batchUpdates: {
        range: string;
        values: (string | number)[][];
      }[] = [];

      // Обрабатываем строки в пакете
      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const globalIndex = i + j;
        const rowNumber = globalIndex + startRow;

        const idLeadFromTable = row[0] || '';
        const stageLead = row[4];
        const inWorking = row[7];
        const firstTouch = row[19];
        const performer = row[37];

        // БЫСТРЫЕ ПРОВЕРКИ
        if (
          (stageLead === 'Закрыто и не реализовано' &&
            performer === 'Не Квал') ||
          !inWorking ||
          inWorking.trim() === '' ||
          (firstTouch && firstTouch.includes('/'))
        ) {
          skippedCount++;
          continue;
        }

        // Проверка ID
        if (!idLeadFromTable) continue;
        const idLead = Number(idLeadFromTable);
        if (isNaN(idLead) || idLead === 0) continue;

        try {
          // КОНТРОЛЬ СКОРОСТИ ДЛЯ AMOCRM
          await rateLimitAmoCRM();

          // 1. Получаем лид
          const lead = await amo.getLeadById(idLead);
          if (!lead) continue;

          // 2. Получаем входящее действие
          await rateLimitAmoCRM();
          const incomingAction = await getCreatedAtIncomingCallOrMessage(lead);
          if (!incomingAction) continue;

          // 3. Проверяем дату
          if (
            isInvalidDateIncoming({
              createAtLead: lead.created_at,
              createAtIncoming: incomingAction.time,
            })
          ) {
            continue;
          }

          // 4. Получаем статусы
          await rateLimitAmoCRM();
          const { leadStatusEngine, leadStatusSerial } =
            await getDataStatusLead(amo, lead);

          // Рассчитываем данные
          const createdAtLead = lead.created_at;
          let timeAllWork = '';
          if (createdAtLead && incomingAction.time) {
            timeAllWork = formatSecondsToHHMM(
              incomingAction.time - createdAtLead,
            );
          }

          let deltaTimeFirstResponse = '';
          let deltaTimeFirstWork = '';

          if (leadStatusEngine) {
            const delta = incomingAction.time - leadStatusEngine.created_at;
            deltaTimeFirstResponse = formatSecondsToHHMM(delta);
            deltaTimeFirstWork = formatDurationDDHHMM(delta).full;
          }
          if (leadStatusSerial) {
            const delta = incomingAction.time - leadStatusSerial.created_at;
            deltaTimeFirstResponse = formatSecondsToHHMM(delta);
            deltaTimeFirstWork = formatDurationDDHHMM(delta).full;
          }

          const [y, mon, d, h, m, s] = getDate(incomingAction.time);
          const dateOutput = `${y}.${mon}.${d} ${h}:${m}`;

          // СОБИРАЕМ ОБНОВЛЕНИЯ
          batchUpdates.push({
            range: `T${rowNumber}:V${rowNumber}`,
            values: [
              [
                `${dateOutput} / ${incomingAction.source}`,
                deltaTimeFirstResponse,
                timeAllWork,
              ],
            ],
          });

          batchUpdates.push({
            range: `AM${rowNumber}:AM${rowNumber}`,
            values: [[deltaTimeFirstWork]],
          });

          batchUpdates.push({
            range: `AS${rowNumber}:AS${rowNumber}`,
            values: [[`${h}:${m}:${s}`]],
          });

          processedCount++;

          // 5. Обновляем в amoCRM (если нужно)
          await rateLimitAmoCRM();
          try {
            await amo.updateLeadDateCall(idLead, dateOutput);
          } catch (amoError) {
            console.log(`⚠️ Ошибка обновления amoCRM: ${idLead}`, amoError);
          }
        } catch (err) {
          if (err instanceof Error) {
            if (
              err.message.includes('429') ||
              err.message.includes('Too Many Requests')
            ) {
              console.log(`🛑 Превышен лимит amoCRM. Ждем 10 секунд...`);
              await new Promise((resolve) => setTimeout(resolve, 10000));
              // Уменьшаем счетчик запросов
              amoRequestsInLastSecond = Math.max(
                0,
                amoRequestsInLastSecond - 3,
              );
              continue; // Пробуем эту строку снова
            }
            console.log(`⚠️ Ошибка строки ${rowNumber}:`, err.message);
          }
        }

        // Небольшая пауза после каждых 10 строк
        if (j % 10 === 0 && j > 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // ОТПРАВЛЯЕМ ОБНОВЛЕНИЯ В GOOGLE SHEETS
      if (batchUpdates.length > 0) {
        console.log(
          `📤 Отправка ${batchUpdates.length} обновлений в Google Sheets`,
        );

        // Разбиваем на подпакеты по 100 запросов
        const MAX_SHEETS_REQUESTS = 100;
        const subBatches = [];
        for (let k = 0; k < batchUpdates.length; k += MAX_SHEETS_REQUESTS) {
          subBatches.push(batchUpdates.slice(k, k + MAX_SHEETS_REQUESTS));
        }

        for (let sb = 0; sb < subBatches.length; sb++) {
          const subBatch = subBatches[sb];

          try {
            await sheet.updateFieldsGooglePack(subBatch);
          } catch (error) {
            console.error(`❌ Ошибка Google Sheets:`, error);

            if (
              error instanceof Error &&
              error.message.includes('Quota exceeded')
            ) {
              console.log(
                `⏳ Превышена квота Google Sheets. Ждем 30 секунд...`,
              );
              await new Promise((resolve) => setTimeout(resolve, 30000));

              // Пробуем еще раз
              try {
                await sheet.updateFieldsGooglePack(subBatch);
              } catch (retryError) {
                console.error(`❌ Повторная ошибка:`, retryError);
              }
            }
          }

          // Задержка между подпакетами Google Sheets
          if (sb < subBatches.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }

      // СТАТИСТИКА И ЗАДЕРЖКА МЕЖДУ ПАКЕТАМИ
      const batchTime = Date.now() - batchStartTime;
      const estimatedRemaining =
        ((totalBatches - batchNumber) * (batchTime + DELAY_BETWEEN_BATCHES)) /
        1000 /
        60;

      console.log(
        `⏱️  Пакет обработан за ${(batchTime / 1000).toFixed(1)} сек`,
      );
      console.log(
        `📊 Прогресс: ${processedCount} обработано, ${skippedCount} пропущено`,
      );
      console.log(`⏳ Осталось примерно: ${estimatedRemaining.toFixed(1)} мин`);

      // ЗАДЕРЖКА МЕЖДУ ПАКЕТАМИ
      if (batchNumber < totalBatches) {
        console.log(`⏳ Задержка ${DELAY_BETWEEN_BATCHES / 1000} сек.`);
        await new Promise((resolve) =>
          setTimeout(resolve, DELAY_BETWEEN_BATCHES),
        );
      }
    }

    const totalTime = (Date.now() - startTime) / 1000 / 60;
    console.log(`\n✅ ОБРАБОТКА ЗАВЕРШЕНА ЗА ${totalTime.toFixed(1)} МИНУТ!`);
    console.log(
      `📊 Итоги: ${processedCount} обработано, ${skippedCount} пропущено`,
    );
  } catch (err) {
    console.error('❌ Глобальная ошибка:', err);
    throw err;
  }
};

// Обновить все поля
export const updateAllFiled = async (isAllField = false) => {
  try {
    const sheet = new TimeSheetService();
    const amo = new AmoAPI();

    const { data: allData, startRow } =
      await sheet.getDataWithRowNumbers(isAllField);
    // Инициализируем кэш пользователей
    await amo.initUsersCache();

    // Подготавливаем данные для пакетного обновления
    const sheetUpdates: {
      range: string;
      values: (string | number)[][];
    }[] = [];

    const pipelinesResponse = await amo.getAllPipelines();
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

    const batchSize = 50;
    let processedCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;
    // Обрабатываем лиды пакетами
    for (let i = 0; i < allData.length; i += batchSize) {
      const batch = allData.slice(i, i + batchSize);

      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const globalIndex = i + j;
        const rowNumber = globalIndex + startRow;
        const idLeadFromTable = row[0] || ''; // A
        try {
          if (!idLeadFromTable) {
            sheetUpdates.push({
              range: `E${rowNumber}:S${rowNumber}`,
              values: [Array(15).fill('')],
            });
            sheetUpdates.push({
              range: `W${rowNumber}:AB${rowNumber}`,
              values: [Array(6).fill('')],
            });
            errorCount++;
            continue;
          }

          const idLead = Number(idLeadFromTable);

          // Проверяем валидность ID
          if (isNaN(idLead) || idLead === 0) {
            sheetUpdates.push({
              range: `E${rowNumber}:S${rowNumber}`,
              values: [Array(15).fill('')],
            });
            sheetUpdates.push({
              range: `W${rowNumber}:AB${rowNumber}`,
              values: [Array(6).fill('')],
            });
            errorCount++;
            continue;
          }

          const lead = await amo.getLeadById(idLead);

          // Обрабатываем случай когда сделка не найдена (204 No Content)
          if (!lead) {
            sheetUpdates.push({
              range: `E${rowNumber}:S${rowNumber}`,
              values: [Array(15).fill('')],
            });
            sheetUpdates.push({
              range: `W${rowNumber}:AB${rowNumber}`,
              values: [Array(6).fill('')],
            });
            notFoundCount++;
            continue;
          }

          const {
            totalTimeLead,
            formattedUpdatedAt,
            reasonForRefusal,
            leadStatusNewRequest,
            leadStatusInProgress,
            statusName,
            pipelineName,
            deltaMain,
            leader,
            serial,
            engine,
            nameIndustry,
            nameProduct,
            currentResponsible,
            leadPipelineQual,
            leadPipelineEng,
            leadPipelineSerial,
            leadLastClosed,
          } = await getParamsLead({ lead, pipelinesMap, amo });

          const [Y, MONTH, D, H, MIN] = getDate(leadStatusNewRequest || 0);
          let outputDateInProgress = '';
          if (leadStatusInProgress) {
            const [y, mon, d, h, min] = getDate(
              leadStatusInProgress.created_at || 0,
            );

            outputDateInProgress = `${y}.${mon}.${d} ${h}:${min}`;
          }

          // Дата закрытия сделки
          if (leadLastClosed && lead.status_id === 143) {
            const [y, m, d] = getDate(leadLastClosed.created_at);
            sheetUpdates.push({
              range: `AV${rowNumber}:AV${rowNumber}`,
              values: [[`${y}.${m}.${d}`]],
            });
          }

          // Рассчет времени сделки в этапе
          if (lead.status_id !== 143 && leadPipelineQual) {
            const sortedStatusCreatedAt = [
              leadPipelineQual.created_at,
              leadPipelineSerial ? leadPipelineSerial.created_at : 0,
              leadPipelineEng ? leadPipelineEng.created_at : 0,
            ].sort((a, b) => b - a);

            const actualStatusCreatedAt = sortedStatusCreatedAt[0];
            // Текущее время
            const now = new Date();
            const currentHours = now.getHours();
            const currentMinutes = now.getMinutes();

            // Определяем, находимся ли в интервале 23:30 - 0:30
            // Это интервал, который пересекает полночь
            const isInSpecialInterval =
              (currentHours === 23 && currentMinutes >= 30) || // 23:30 - 23:59
              (currentHours === 1 && currentMinutes <= 30); // 00:00 - 00:30

            // Исходная дельта
            const delta = Date.now() / 1000 - actualStatusCreatedAt;

            // Если находимся в специальном интервале, добавляем 9 часов (32400 секунд)
            const adjustedDelta = isInSpecialInterval
              ? delta + 9 * 3600 // Добавляем 9 часов в секундах
              : delta;
            const { dd, hh, mm } = formatDurationDDHHMM(adjustedDelta);
            const outputDateDurationLead = `${dd}:${hh}:${mm}`;

            sheetUpdates.push({
              range: `AW${rowNumber}:AW${rowNumber}`,
              values: [[outputDateDurationLead]],
            });
          }

          // Добавляем обновления
          sheetUpdates.push({
            range: `E${rowNumber}:S${rowNumber}`,
            values: [
              [
                statusName,
                pipelineName,
                `${Y}.${MONTH}.${D} ${H}:${MIN}`,
                outputDateInProgress,
                deltaMain,
                leader,
                serial.createAt,
                serial.delta,
                serial.responsible || '',
                engine.createAt,
                engine.delta,
                engine.responsible || '',
                '',
                '',
                '',
              ],
            ],
          });

          let techStatus = pipelineName;

          if (reasonForRefusal) {
            techStatus = 'Отказ';
          }
          if (
            (pipelineName === 'Отдел инжиниринга' ||
              pipelineName === 'Отдел серийного оборудования' ||
              pipelineName === 'Квалификация') &&
            (statusName === '7. Нецелевой лид' ||
              statusName === '10. Закрыто и не реализовано' ||
              statusName === '8. Закрыто и не реализовано')
          ) {
            techStatus = 'Отказ';
          }
          if (
            statusName !== '10. Закрыто и не реализовано' &&
            statusName !== '8. Закрыто и не реализовано' &&
            (pipelineName === 'Отдел инжиниринга' ||
              pipelineName === 'Отдел серийного оборудования')
          ) {
            techStatus = 'Кв. Лид';
          }

          sheetUpdates.push({
            range: `W${rowNumber}:AC${rowNumber}`,
            values: [
              [
                formattedUpdatedAt,
                reasonForRefusal,
                lead.price,
                totalTimeLead,
                nameIndustry,
                nameProduct,
                techStatus,
              ],
            ],
          });

          const [year, month, day] = getDate(lead.created_at);
          sheetUpdates.push({
            range: `AH${rowNumber}:AJ${rowNumber}`,
            values: [[day, month, year.slice(2)]],
          });

          let techManager = '';
          if (
            !serial.responsible &&
            !engine.responsible &&
            currentResponsible &&
            currentResponsible.id === 9380670
          ) {
            techManager = 'Не Квал';
          } else {
            const user = currentResponsible;
            if (user) {
              techManager = user.name;
            }
          }

          sheetUpdates.push({
            range: `AL${rowNumber}:AL${rowNumber}`,
            values: [[techManager]],
          });

          processedCount++;
        } catch (err) {
          errorCount++;
          if (err instanceof Error) {
            console.log(
              `Ошибка при обработке лида ${batch[j]}: ${err.message}`,
            );

            // Записываем ошибку в таблицу
            sheetUpdates.push({
              range: `E${rowNumber}:S${rowNumber}`,
              values: [Array(15).fill('')],
            });
            sheetUpdates.push({
              range: `W${rowNumber}:AB${rowNumber}`,
              values: [Array(6).fill('')],
            });
          }
        }
      }

      // Пакетное обновление
      if (sheetUpdates.length > 0) {
        try {
          await sheet.updateFieldsGooglePack(sheetUpdates);
          sheetUpdates.length = 0;
        } catch (updateError) {
          console.error('Ошибка при обновлении Google Sheets:', updateError);
          // Не очищаем sheetUpdates, попробуем еще раз в следующем пакете
        }
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.log('error' + error.message);
    }
  }
};
