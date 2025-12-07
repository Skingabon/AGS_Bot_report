import { formatDate, formatTimeHHMMSS, getDate } from '../util/helper';
import { ControlSheetService } from '../services/apiGoogleTable';
import { getLeadsTodayOrByPeriod } from './utils';
import { DOMAIN } from './contants';
import {
  communicationType,
  incomingActionDateFromContact,
  incomingCallDate,
} from './updateFields';
import { AmoAPI } from '../services/apiAmo';

export const createReportControlByPeriod = async (
  startDate?: string,
  endDate?: string,
) => {
  try {
    const { leads } = await getLeadsTodayOrByPeriod(startDate, endDate);

    console.log(`📊 Создание ${leads.length} базовых строк сделок`);

    const googleSheetsData: (string | number)[][] = [];
    const sheetService = new ControlSheetService();

    // Получаем все строки таблицы
    const allRows = await sheetService.getRangeValues(`A2:R`);
    const existingLeadIds = new Set<number>();
    for (const row of allRows) {
      const leadId = Number(row[0]);
      if (!isNaN(leadId) && leadId > 0) {
        existingLeadIds.add(leadId);
      }
    }

    // const delay = (ms: number) =>
    //   new Promise((resolve) => setTimeout(resolve, ms));

    // ТОЛЬКО БАЗОВЫЕ СТРОКИ СДЕЛОК
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];

      if (existingLeadIds.has(lead.id)) continue;

      // if (i > 0) await delay(500); // Небольшая задержка

      const createdAtFormatted = formatDate(lead.created_at);
      const [year, month, day] = getDate(lead.created_at);

      // БАЗОВАЯ СТРОКА СДЕЛКИ (без действий)
      googleSheetsData.push([
        lead.id, // A
        lead.name, // B
        `https://${DOMAIN}.amocrm.ru/leads/detail/${lead.id}`, // C
        createdAtFormatted, // D
        '-', // E - место для отметки
        '', // F - пусто (заполнится при update)
        '', // G - пусто
        '', // H - пусто
        '', // I - пусто
        '', // J - пусто
        '', // K - пусто
        '', // L - пусто
        '', // M - пусто
        '', // N - пусто
        day, // O - день
        month, // P - месяц
        year, // Q - год
        '', // R - пусто
      ]);
    }

    // Записываем в таблицу
    if (googleSheetsData.length > 0) {
      await sheetService.createGoogleFields({ values: googleSheetsData });
      console.log(`✅ Создано ${googleSheetsData.length} базовых строк сделок`);
    }
  } catch (error) {
    console.error('❌ Ошибка создания:', error);
    throw error;
  }
};

// const FIRST_DATA_ROW = 2;
// const LAST_COL = 'R';

export const updateReportControlDaily = async (): Promise<void> => {
  try {
    const sheetService = new ControlSheetService();
    const amo = new AmoAPI();

    // Получаем все строки таблицы
    const allRows = await sheetService.getRangeValues(`A2:R`);
    console.log(`📊 Найдено ${allRows.length} строк в таблице`);

    // Собираем ВСЕ существующие действия для сравнения
    const existingActions = new Set<string>();

    allRows.forEach((row) => {
      const actionKey = createActionKey(row);
      if (actionKey) {
        existingActions.add(actionKey);
      }
    });

    // Для обновления базовых строк
    const updatePromises: Promise<any>[] = [];

    // Идем снизу вверх
    for (let i = allRows.length - 1; i >= 0; i--) {
      const row = allRows[i];
      const currentRowNumber = i + 2;

      const leadId = Number(row[0]);
      if (!leadId || isNaN(leadId)) continue;

      console.log(`🔄 Проверка сделки ${leadId} (строка ${currentRowNumber})`);

      try {
        const leadCreatedAt = row[3];
        const createdAtTimestamp = Math.floor(
          new Date(leadCreatedAt).getTime() / 1000,
        );

        // Получаем данные сделки
        const fromContact = await incomingActionDateFromContact(
          leadId,
          createdAtTimestamp,
        );
        const fromNotes = await incomingCallDate(leadId);
        const tasks = await amo.getTasks(leadId);

        const communications = [
          ...(fromContact?.communications || []),
          ...(fromNotes?.communications || []),
        ];
        const validTasks = tasks.filter((t) => t.duration);

        if (!validTasks.length && !communications.length) {
          console.log(`⏭️ У сделки ${leadId} нет действий`);
          continue;
        }

        // Подготавливаем данные для вставки (ТОЛЬКО НОВЫЕ)
        const newRowsToInsert: (string | number)[][] = [];

        // 1. Проверяем и добавляем новые коммуникации
        communications.forEach((touch) => {
          const [y, mon, d, h, m, s] = getDate(touch.time);

          const rowData = [
            leadId, // A
            row[1] || '', // B
            row[2] || '', // C
            row[3] || '', // D
            '-', // E
            touch.core || '', // F
            touch.source || '', // G
            touch.text || '', // H
            `${touch.source} ${touch.source !== 'Примечание' ? (touch.income ? 'вход' : 'исх') : ''}`, // I
            touch.source === 'Звонок' ? (touch.isDoCall ? 'Да' : 'Нет') : '', // J
            touch.source === 'Звонок' && touch.isDoCall
              ? formatTimeHHMMSS(touch.durationCall || 0)
              : '', // K
            `${y}.${mon}.${d}`, // L
            `${h}:${m}:${s}`, // M
            '-', // N
            row[14] || '', // O
            row[15] || '', // P
            row[16] || '', // Q
            touch.linkCall || '', // R
          ];

          // Проверяем, есть ли уже такое действие в таблице
          const actionKey = createActionKey(rowData);
          if (actionKey && !existingActions.has(actionKey)) {
            newRowsToInsert.push(rowData);
            existingActions.add(actionKey);
          }
        });

        // 2. Проверяем и добавляем новые задачи
        validTasks.forEach((task) => {
          const [y, mon, d, h, m, s] = getDate(task.created_at);

          const rowData = [
            leadId, // A
            row[1] || '', // B
            row[2] || '', // C
            row[3] || '', // D
            '-', // E
            'task', // F
            'Задачи', // G
            task.text || '', // H
            'Встреча', // I
            '', // J
            '', // K
            `${y}.${mon}.${d}`, // L
            `${h}:${m}:${s}`, // M
            formatTimeHHMMSS(task.duration), // N
            row[14] || '', // O
            row[15] || '', // P
            row[16] || '', // Q
            '-', // R
          ];

          const actionKey = createActionKey(rowData);
          if (actionKey && !existingActions.has(actionKey)) {
            newRowsToInsert.push(rowData);
            existingActions.add(actionKey);
          }
        });

        // 3. ОБНОВЛЯЕМ БАЗОВУЮ СТРОКУ, если она пустая
        const isBaseRowEmpty = !row[5] && !row[6] && !row[7]; // F, G, H пустые

        if (
          isBaseRowEmpty &&
          (communications.length > 0 || validTasks.length > 0)
        ) {
          // Берем первое действие для обновления базовой строки
          let firstAction: any = null;

          if (communications.length > 0) {
            firstAction = communications[0];
          } else if (validTasks.length > 0) {
            firstAction = validTasks[0];
          }

          if (firstAction) {
            let updateRowData: (string | number)[] = [];

            // Type guard для коммуникаций
            const isCommunication = (
              action: any,
            ): action is communicationType => {
              return 'source' in action;
            };

            // Type guard для задач (предполагаем, что Task имеет поле duration)
            const isTask = (
              action: any,
            ): action is {
              created_at: number;
              text?: string;
              duration: number;
            } => {
              return 'duration' in action && 'created_at' in action;
            };

            if (isCommunication(firstAction)) {
              // Это коммуникация
              const touch = firstAction;
              const [y, mon, d, h, m, s] = getDate(touch.time);

              updateRowData = [
                leadId, // A
                row[1] || '', // B
                row[2] || '', // C
                row[3] || '', // D
                '-', // E
                touch.core || '', // F
                touch.source || '', // G
                touch.text || '', // H
                `${touch.source} ${touch.source !== 'Примечание' ? (touch.income ? 'вход' : 'исх') : ''}`, // I
                touch.source === 'Звонок'
                  ? touch.isDoCall
                    ? 'Да'
                    : 'Нет'
                  : '', // J
                touch.source === 'Звонок' && touch.isDoCall
                  ? formatTimeHHMMSS(touch.durationCall || 0)
                  : '', // K
                `${y}.${mon}.${d}`, // L
                `${h}:${m}:${s}`, // M
                '-', // N
                row[14] || '', // O
                row[15] || '', // P
                row[16] || '', // Q
                touch.linkCall || '', // R
              ];
            } else if (isTask(firstAction)) {
              // Это задача
              const task = firstAction;
              const [y, mon, d, h, m, s] = getDate(task.created_at);

              updateRowData = [
                leadId, // A
                row[1] || '', // B
                row[2] || '', // C
                row[3] || '', // D
                '-', // E
                'task', // F
                'Задачи', // G
                task.text || '', // H
                'Встреча', // I
                '', // J
                '', // K
                `${y}.${mon}.${d}`, // L
                `${h}:${m}:${s}`, // M
                formatTimeHHMMSS(task.duration), // N
                row[14] || '', // O
                row[15] || '', // P
                row[16] || '', // Q
                '-', // R
              ];
            } else {
              // Если тип неизвестен, пропускаем обновление
              console.log(`⚠️ Неизвестный тип действия для сделки ${leadId}`);
            }

            if (updateRowData.length) {
              // Обновляем базовую строку
              updatePromises.push(
                sheetService.updateFieldsGooglePack([
                  {
                    range: `A${currentRowNumber}:R${currentRowNumber}`,
                    values: [updateRowData],
                  },
                ]),
              );

              console.log(
                `✏️ Будет обновлена базовая строка ${currentRowNumber} для сделки ${leadId}`,
              );

              // Убираем это действие из newRowsToInsert, если оно там есть
              const actionKey = createActionKey(updateRowData);
              const actionIndex = newRowsToInsert.findIndex(
                (r) => createActionKey(r) === actionKey,
              );
              if (actionIndex !== -1) {
                newRowsToInsert.splice(actionIndex, 1);
              }
            }
          }
        }

        // 4. Добавляем ОСТАЛЬНЫЕ НОВЫЕ действия в конец таблицы
        if (newRowsToInsert.length > 0) {
          updatePromises.push(
            sheetService.createGoogleFields({ values: newRowsToInsert }),
          );
          console.log(
            `➕ Добавлено ${newRowsToInsert.length} новых действий для сделки ${leadId}`,
          );
        } else {
          console.log(`⏭️ Для сделки ${leadId} нет новых действий`);
        }
      } catch (error) {
        if (error instanceof Error)
          console.error(`❌ Ошибка обработки сделки ${leadId}:`, error.message);
      }
    }

    // Выполняем все обновления
    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
      console.log(`✅ Все обновления выполнены`);
    }

    console.log(`✅ Обновление полей завершено`);
  } catch (error) {
    console.error('❌ Глобальная ошибка при обновлении полей:', error);
    throw error;
  }
};

// Функция для создания уникального ключа действия
function createActionKey(rowData: (string | number)[]): string {
  // Ключ на основе ID сделки + источника + текста + времени
  const leadId = rowData[0];
  const source = rowData[6]; // G
  const text = rowData[7]; // H
  const date = rowData[11]; // L
  const time = rowData[12]; // M

  return `${leadId}_${source}_${text}_${date}_${time}`;
}
