import { isMessageNote, Lead } from '../interfaces';
import {
  formatDate,
  formatDiff,
  formatSecondsToHHMM,
  getDate,
  getFieldValue,
  parseCustomDate,
  safeParseDate,
  startRangeWith,
} from '../util/helper';
import {
  ControlSheetService,
  TimeSheetService,
} from '../services/apiGoogleTable';
import { AmoAPI } from '../services/apiAmo';
import { getParamsLead } from './utils';

type requiredCommunicationType = {
  id: number;
  source: 'Письмо' | 'Звонок' | 'Примечание';
  time: number;
  core: 'contact' | 'note' | 'task';
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
        });
      }
      if (el.note_type === 'common') {
        communications.push({
          id: el.id,
          source: 'Примечание',
          time: el.created_at,
          text: el.params.text,
          core: 'note',
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

// Получить все действия с сделкой
export const getAllAction = async () => {
  try {
    const ids = (
      await new ControlSheetService().getGoogleSheetData('A')
    ).flat();
    console.log(ids);
    //
    // const fromContact = await incomingActionDateFromContact(ids[0][0], ids[0][0]);
    // const fromNotes = await incomingCallDate(28936593);
  } catch (err) {
    if (err instanceof Error) console.log(err.message);
  }
};

//Заполняю звонки за прошлые периоды если их небыло раньше
export const updateIncomingCall = async (isAllField = false) => {
  try {
    // Получаем данные из таблицы
    const rowLength =
      (await new TimeSheetService().getGoogleSheetData('A')).flat().length + 1;
    const startRange = startRangeWith(isAllField, rowLength);
    const allData = await new TimeSheetService().getRangeValues(
      `A${startRange}:AL${rowLength}`,
    );
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

          const lead = await new AmoAPI().getLeadById(idLead);

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

          const createdAtLead = lead.created_at;

          let timeAllWork = '-';
          if (createdAtLead && incomingAction.time) {
            timeAllWork = formatSecondsToHHMM(
              incomingAction.time - createdAtLead,
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

          const [year, month, day, hours, minutes, seconds] = getDate(
            incomingAction.time,
          );
          const dateOutput = `${year}.${month}.${day} ${hours}:${minutes}`;
          const incomingDate = safeParseDate(dateOutput);

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
                `${dateOutput} / ${incomingAction.source}`,
                deltaTimeFirstResponse || 'В сделке нет ОМ квал',
                timeAllWork,
              ],
            ],
          });
          sheetUpdates.push({
            range: `AS${rowNumber}:AS${rowNumber}`,
            values: [[`${hours}:${minutes}:${seconds}`]],
          });

          amoUpdatesPromises.push(
            new AmoAPI().updateLeadDateCall(idLead, dateOutput),
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
        await new TimeSheetService().updateFieldsGooglePack(sheetUpdates);
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

// Обновить все поля
export const updateAllFiled = async (isAllField = false) => {
  try {
    const rowLength =
      (await new TimeSheetService().getGoogleSheetData('A')).flat().length + 1;
    const startRange = startRangeWith(isAllField, rowLength);
    const allData = await new TimeSheetService().getRangeValues(
      `A${startRange}:AL${rowLength}`,
    );

    // Подготавливаем данные для пакетного обновления
    const sheetUpdates: {
      range: string;
      values: (string | number)[][];
    }[] = [];

    const pipelinesResponse = await new AmoAPI().getAllPipelines();
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

          const lead = await new AmoAPI().getLeadById(idLead);

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

          const { day, month, year } = dateFormatted;
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
          await new TimeSheetService().updateFieldsGooglePack(sheetUpdates);
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
