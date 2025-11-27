import { isCallNote, isMessageNote, Lead } from '../interfaces';
import {
  formatDate,
  formatDiff,
  getDate,
  getFieldValue,
  parseCustomDate,
  parseDate,
  safeParseDate,
  startRangeWith,
} from '../util/helper';
import {
  getAllPipelines,
  getContactsByIdLead,
  getLeadById,
  getNotesByIdContact,
  getNotesByLead,
  updateLeadDateCall,
} from '../services/apiAmo';
import {
  getGoogleSheetData,
  getRangeValues,
  sortSheetByDate,
  updateFieldsGooglePack,
} from '../services/apiGoogleTable';
import { statusMap } from './statusList';

export const getStatusLead = (lead: Lead): string => {
  return (
    statusMap[lead.status_id] || `Неизвестный статус (ID: ${lead.status_id})`
  );
};

type getParamsLeadType = {
  lead: Lead;
  pipelinesMap: { [p: number]: string };
};

export const getParamsLead = ({ lead, pipelinesMap }: getParamsLeadType) => {
  const pipelineName = pipelinesMap[lead.pipeline_id] || 'Не найдено';

  // Добавляем название статуса в зависимости от ID статуса
  //Заменить на switch case
  const statusName = getStatusLead(lead);

  //новые поля
  const fields = lead.custom_fields_values || [];
  const newLeadSourse = getFieldValue(fields, 'Источник лида') || '';
  const reasonForRefusal = getFieldValue(fields, 'Причина отказа') || '';
  const dateContract = getFieldValue(fields, 'Дата Договор заключен');
  const dateNoLead = getFieldValue(fields, 'Дата Не целевой лид');
  const totalTimeLead = formatDate(dateContract || dateNoLead);
  const nameIndustry = getFieldValue(fields, 'Отрасль') || '';
  const nameProduct = getFieldValue(fields, 'Оборудование') || '';

  const omTakenAt = formatDate(
    getFieldValue(fields, 'Дата/время взято в работу'),
  ); // Форматируем сразу
  const omTakenBy = getFieldValue(fields, 'ОМ Взято в работу') || '';

  const omAssignedAt = formatDate(getFieldValue(fields, 'Время ОМ квал серия'));
  const omAssignedBy = getFieldValue(fields, 'ОМ Квал серия') || '';
  const omTakenByIng = getFieldValue(fields, 'ОМ Квал инж') || '';
  const omRaspredByIng = getFieldValue(fields, 'Распр ОМ квал ИНЖ') || '';
  const omRaspredByIngTime = formatDate(
    getFieldValue(fields, 'Время Распр ОМ квал ИНЖ'),
  );
  const omTakeIng = formatDate(getFieldValue(fields, 'Дата/время КВАЛ инж'));

  // Берем нужные даты
  const createdDate = new Date(lead.created_at * 1000);
  const createdAtFormatted = formatDate(lead.created_at); // "2025.04.22 15:30"
  const dateFormatted = parseDate(createdAtFormatted);
  const takenDate = omTakenAt ? parseCustomDate(omTakenAt) : null; // Парсим обратно, если нужно
  const takeIngDate = omTakeIng ? parseCustomDate(omTakeIng) : null;
  const assignedDate = omAssignedAt ? parseCustomDate(omAssignedAt) : null;

  // Вычисляем разницу
  let diffCreatedToTaken = '';
  if (takenDate && !isNaN(takenDate.getTime())) {
    const diffMs = takenDate.getTime() - createdDate.getTime();
    diffCreatedToTaken = formatDiff(diffMs);
  }

  let diffTakenToTakeIng: string;
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

  const date = new Date(lead.updated_at * 1000);
  const formattedUpdatedAt = `${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU')}`;

  return {
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
    omRaspredByIng,
    formattedUpdatedAt, // 19 W Дата/время последнего обновления в сделке
    reasonForRefusal, // X причина отказа
    totalTimeLead, // Z
    nameIndustry, // AA
    nameProduct, //AB
    dateFormatted, // Дата формата: 22 4 25
  };
};

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
export const updateIncomingCall = async (isAllField = false) => {
  try {
    // Получаем данные из таблицы
    const rowLength = (await getGoogleSheetData('A')).flat().length + 1;
    const startRange = startRangeWith(isAllField, rowLength);
    const allData = await getRangeValues(`A${startRange}:AL${rowLength}`);

    // Подготавливаем данные для пакетного обновления
    const sheetUpdates: {
      range: string;
      values: (string | number)[][];
    }[] = [];

    const amoUpdatesPromises: Promise<void>[] = [];
    const batchSize = 50;
    let processedCount = 0;
    let skippedCount = 0;

    // Обрабатываем лиды пакетами
    for (let i = 0; i < allData.length; i += batchSize) {
      const batch = allData.slice(i, i + batchSize);

      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const globalIndex = i + j;

        const idLeadFromTable = row[0] || ''; // A
        const stageLead = row[4]; // E
        const inWorking = row[7]; // H
        const firstTouch = row[19]; // T
        const performer = row[37]; // AL
        const rowNumber = globalIndex + startRange;
        console.log(
          performer,
          stageLead === 'Закрыто и не реализовано' && performer === 'Не Квал',
        );
        // 1. Пропускаем если статус "Закрыто и не реализовано" и не квал
        if (
          stageLead === 'Закрыто и не реализовано' &&
          performer === 'Не Квал'
        ) {
          sheetUpdates.push({
            range: `T${rowNumber}:V${rowNumber}`,
            values: [['Не актуально', '-', '-']],
          });
          skippedCount++;
          continue;
        }

        if (!inWorking || inWorking.trim() === '') {
          sheetUpdates.push({
            range: `T${rowNumber}:V${rowNumber}`,
            values: [['-', '-', '-']],
          });
          skippedCount++;
          continue;
        }

        // 2. Пропускаем если УЖЕ ЕСТЬ данные о первом касании (кроме определенных значений)
        // const shouldProcessFirstTouch =
        //   firstTouch === 'Старый лид' ||
        //   firstTouch === 'Ошибка обработки' ||
        //   firstTouch === 'Лид не найден' ||
        //   firstTouch === 'Неверный ID' ||
        //   firstTouch !== '-';

        if (firstTouch.includes('/')) {
          // Если уже есть нормальные данные - пропускаем
          // console.log(
          //   `Пропускаем строку ${rowNumber} - уже есть данные: "${firstTouch}"`,
          // );
          skippedCount++;
          continue;
        }

        try {
          // Проверка валидности ID
          if (!idLeadFromTable) continue;
          const idLead = Number(idLeadFromTable);

          if (isNaN(Number(idLead)) || Number(idLead) === 0) {
            sheetUpdates.push({
              range: `T${rowNumber}:V${rowNumber}`,
              values: [['Неверный ID', '-', '-']],
            });
            continue;
          }

          const lead = await getLeadById(idLead);

          if (!lead) {
            sheetUpdates.push({
              range: `T${rowNumber}:V${rowNumber}`,
              values: [['Лид не найден', '-', '-']],
            });
            continue;
          }

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

          // Обработка данных...
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

          amoUpdatesPromises.push(
            updateLeadDateCall(idLead, getDate(incomingAction.time)),
          );

          processedCount++;
        } catch (err) {
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

      // Пакетное обновление
      if (sheetUpdates.length > 0) {
        await updateFieldsGooglePack(sheetUpdates);
        sheetUpdates.length = 0;
      }
    }

    await Promise.all(amoUpdatesPromises);
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Глобальная ошибка: ${err.message}`);
    }
  }
};

export const updateAllFiled = async (isAllField = false) => {
  try {
    const rowLength = (await getGoogleSheetData('A')).flat().length + 1;
    const startRange = startRangeWith(isAllField, rowLength);
    const allData = await getRangeValues(`A${startRange}:AL${rowLength}`);

    // Подготавливаем данные для пакетного обновления
    const sheetUpdates: {
      range: string;
      values: (string | number)[][];
    }[] = [];

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

    const batchSize = 50;
    let processedCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;
    //TODO: нужно пропускать "Закрыто и не реализовано", но когда нет менеджеров
    //const allData = await getRangeValues(`A2:AK${rowLength + 1}`);
    // Обрабатываем лиды пакетами
    for (let i = 0; i < allData.length; i += batchSize) {
      const batch = allData.slice(i, i + batchSize);

      for (let j = 0; j < batch.length; j++) {
        const row = batch[j]; // ← ИСПРАВЛЕНО: было allData[i], стало batch[j]
        const globalIndex = i + j;
        const rowNumber = globalIndex + startRange;
        const idLeadFromTable = row[0] || ''; // A

        try {
          if (!idLeadFromTable) {
            sheetUpdates.push({
              range: `E${rowNumber}:S${rowNumber}`,
              values: [Array(15).fill('Пустой ID')],
            });
            sheetUpdates.push({
              range: `W${rowNumber}:AB${rowNumber}`,
              values: [Array(6).fill('Пустой ID')],
            });
            errorCount++;
            continue;
          }

          const idLead = Number(idLeadFromTable);

          // Проверяем валидность ID
          if (isNaN(idLead) || idLead === 0) {
            sheetUpdates.push({
              range: `E${rowNumber}:S${rowNumber}`,
              values: [Array(15).fill('Неверный ID')],
            });
            sheetUpdates.push({
              range: `W${rowNumber}:AB${rowNumber}`,
              values: [Array(6).fill('Неверный ID')],
            });
            errorCount++;
            continue;
          }

          const lead = await getLeadById(idLead);

          // Обрабатываем случай когда сделка не найдена (204 No Content)
          if (!lead) {
            sheetUpdates.push({
              range: `E${rowNumber}:S${rowNumber}`,
              values: [Array(15).fill('Сделка не найдена')],
            });
            sheetUpdates.push({
              range: `W${rowNumber}:AB${rowNumber}`,
              values: [Array(6).fill('Сделка не найдена')],
            });
            notFoundCount++;
            continue;
          }

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
            totalTimeLead,
            nameIndustry,
            nameProduct,
            dateFormatted,
          } = getParamsLead({ lead, pipelinesMap });
          const { day, month, year } = dateFormatted;

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
            range: `W${rowNumber}:AB${rowNumber}`,
            values: [
              [
                formattedUpdatedAt,
                reasonForRefusal,
                lead.price,
                totalTimeLead,
                nameIndustry,
                nameProduct,
              ],
            ],
          });
          sheetUpdates.push({
            range: `AH${rowNumber}:AJ${rowNumber}`,
            values: [[day, month, year]],
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
              values: [Array(15).fill('Ошибка обработки')],
            });
            sheetUpdates.push({
              range: `W${rowNumber}:AB${rowNumber}`,
              values: [Array(6).fill('Ошибка обработки')],
            });
          }
        }
      }

      // Пакетное обновление
      if (sheetUpdates.length > 0) {
        try {
          await updateFieldsGooglePack(sheetUpdates);
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
