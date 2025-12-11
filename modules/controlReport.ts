import {
  formatDate,
  formatTimeHHMMSS,
  getDate,
  getFieldValue,
} from '../util/helper';
import { ControlSheetService } from '../services/apiGoogleTable';
import { getLeadsTodayOrByPeriod } from './utils';
import { DOMAIN } from './contants';
import {
  incomingActionDateFromContact,
  incomingCallDate,
} from './updateFields';
import { AmoAPI } from '../services/apiAmo';
import { Task } from '../interfaces';
import { getStatusLead } from './statusList';

export const createReportControlByPeriod = async (
  startDate?: string,
  endDate?: string,
) => {
  try {
    const sheetService = new ControlSheetService();
    const amo = new AmoAPI();

    // Инициализируем кэш пользователей
    await amo.initUsersCache();

    const { leads, pipelinesMap } = await getLeadsTodayOrByPeriod(
      startDate,
      endDate,
    );
    console.log(`📊 Найдено ${leads.length} сделок за период`);

    // Получаем существующие ID сделок
    const allRows = await sheetService.getRangeValues('A2:R');
    const existingLeadIds = new Set<number>();
    for (const row of allRows) {
      const leadId = Number(row[0]);
      if (!isNaN(leadId) && leadId > 0) {
        existingLeadIds.add(leadId);
      }
    }

    // Собираем данные для новых сделок
    const googleSheetsData: (string | number)[][] = [];

    // Обрабатываем сделки пакетами
    await sheetService.processInBatches(
      leads,
      async (batch, batchIndex) => {
        const batchPromises = batch.map(async (lead) => {
          // Пропускаем существующие сделки
          if (existingLeadIds.has(lead.id)) return null;

          const fields = lead.custom_fields_values || [];
          const omTakenBy = getFieldValue(fields, 'ОМ Взято в работу');
          if (!omTakenBy) return null;

          // Получаем данные пользователя из кэша
          const user = await amo.getUser(lead.responsible_user_id);
          const createdAtFormatted = formatDate(lead.created_at);
          const [year, month, day] = getDate(lead.created_at);
          const leadPipeline = pipelinesMap[lead.pipeline_id];
          const statusLead = getStatusLead({
            statusId: lead.status_id,
            pipelineId: lead.pipeline_id,
          });

          return [
            lead.id, // A
            lead.name, // B
            `https://${DOMAIN}.amocrm.ru/leads/detail/${lead.id}`, // C
            createdAtFormatted, // D
            user ? user.name : '', // E - Ответственный
            '', // F
            '', // G
            '', // H
            '', // I
            '', // J
            '', // K
            '', // L
            '', // M
            '', // N
            day, // O
            month, // P
            year, // Q
            '', // R
            statusLead, // S Этап
            leadPipeline, // T Воронка
          ];
        });

        const batchResults = await Promise.all(batchPromises);
        const validResults = batchResults.filter((row) => row !== null) as (
          | string
          | number
        )[][];

        if (validResults.length > 0) {
          googleSheetsData.push(...validResults);
          console.log(
            `✅ Пакет ${batchIndex + 1}: добавлено ${validResults.length} строк`,
          );
        }
      },
      20, // batchSize
      1000, // delayBetweenBatches
    );

    // Записываем все новые строки пакетами
    if (googleSheetsData.length > 0) {
      console.log(
        `📦 Итоговый пакет для записи: ${googleSheetsData.length} строк`,
      );

      // Разбиваем на пакеты по 500 строк для надежности
      const MAX_ROWS_PER_BATCH = 500;

      for (let i = 0; i < googleSheetsData.length; i += MAX_ROWS_PER_BATCH) {
        const batch = googleSheetsData.slice(i, i + MAX_ROWS_PER_BATCH);
        const batchNumber = Math.floor(i / MAX_ROWS_PER_BATCH) + 1;
        const totalBatches = Math.ceil(
          googleSheetsData.length / MAX_ROWS_PER_BATCH,
        );

        console.log(
          `💾 Запись пакета ${batchNumber}/${totalBatches} (${batch.length} строк)`,
        );

        try {
          await sheetService.createGoogleFieldsBatch({ values: batch });
        } catch (error) {
          console.error(`❌ Ошибка записи пакета ${batchNumber}:`, error);
          // Пробуем записать меньшими пакетами
          const SMALL_BATCH = 100;
          for (let j = 0; j < batch.length; j += SMALL_BATCH) {
            const smallBatch = batch.slice(j, j + SMALL_BATCH);
            try {
              await sheetService.createGoogleFieldsBatch({
                values: smallBatch,
              });
              await new Promise((resolve) => setTimeout(resolve, 500));
            } catch (smallError) {
              console.error('❌ Ошибка записи малого пакета:', smallError);
            }
          }
        }

        // Задержка между пакетами записи
        if (i + MAX_ROWS_PER_BATCH < googleSheetsData.length) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      console.log(`✅ Создано ${googleSheetsData.length} базовых строк сделок`);
    } else {
      console.log('⏭️ Нет новых сделок для создания');
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

    // Инициализируем кэш пользователей
    await amo.initUsersCache();

    // Получаем все строки таблицы
    const allRows = await sheetService.getRangeValues('A2:R');
    console.log(`📊 Найдено ${allRows.length} строк в таблице`);

    // Собираем ВСЕ существующие действия для сравнения
    const existingActions = new Set<string>();
    allRows.forEach((row) => {
      const actionKey = createActionKey(row);
      if (actionKey) {
        existingActions.add(actionKey);
      }
    });

    // Массивы для пакетной обработки
    const updates: Array<{ range: string; values: any[][] }> = [];
    const newRows: (string | number)[][] = [];

    // ВАЖНО: Убираем Promise.all и обрабатываем последовательно
    // с задержками между запросами к amoCRM

    // Функция для задержки
    const delay = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    // Обрабатываем строки по одной, но с задержками
    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      const currentRowNumber = i + 2;
      const leadId = Number(row[0]);

      if (!leadId || isNaN(leadId)) {
        console.log(`⏭️ Строка ${currentRowNumber}: пропуск, нет leadId`);
        continue;
      }

      console.log(
        `\n🔄 [${i + 1}/${allRows.length}] Обработка сделки ${leadId}`,
      );

      try {
        // Задержка между запросами к amoCRM (минимум 100мс)
        if (i > 0) {
          await delay(150); // Задержка 150мс между запросами
        }

        // Получаем timestamp
        let createdAtTimestamp: number;
        try {
          const leadCreatedAt = row[3];
          createdAtTimestamp = Math.floor(
            new Date(leadCreatedAt).getTime() / 1000,
          );
        } catch {
          createdAtTimestamp = Math.floor(Date.now() / 1000);
        }

        // ПОСЛЕДОВАТЕЛЬНО получаем данные сделки (без Promise.all)
        let fromContact = null;
        let fromNotes = null;
        let tasks: Task[] = [];

        try {
          // 1. Получаем fromContact
          console.log(`   📞 Получение контактов...`);
          fromContact = await incomingActionDateFromContact(
            leadId,
            createdAtTimestamp,
          );

          // Задержка между запросами к amoCRM
          await delay(100);

          // 2. Получаем fromNotes
          console.log(`   📝 Получение примечаний...`);
          fromNotes = await incomingCallDate(leadId);

          // Задержка между запросами к amoCRM
          await delay(100);

          // 3. Получаем задачи
          console.log(`   ✅ Получение задач...`);
          tasks = await amo.getTasks(leadId);
        } catch (error) {
          console.error(
            `   ⚠️ Ошибка получения данных для сделки ${leadId}:`,
            error,
          );
          continue; // Пропускаем эту сделку при ошибке
        }

        const communications = [
          ...(fromContact?.communications || []),
          ...(fromNotes?.communications || []),
        ];
        const validTasks = tasks.filter((t) => t.result.text || t.text);

        if (!validTasks.length && !communications.length) {
          console.log(`   ⏭️ Нет действий для сделки ${leadId}`);
          continue;
        }

        console.log(
          `   📊 Найдено: ${communications.length} комм., ${validTasks.length} задач`,
        );

        // Новые действия для этой сделки
        const localNewRows: (string | number)[][] = [];
        let shouldUpdateBaseRow = false;
        let updateRowData: (string | number)[] = [];
        const isBaseRowEmpty = !row[5] && !row[6] && !row[7]; // F, G, H пустые

        // Обрабатываем коммуникации
        communications.forEach((touch) => {
          if (touch.source === 'Звонок') {
            // Проверяем, есть ли ссылка
            if (!touch.linkCall || touch.linkCall === '-') {
              console.log(
                `   ⚠️ Пропуск звонка без ссылки для сделки ${leadId}`,
              );
              return;
            }

            // Дополнительно: проверяем, не является ли это дубликатом email/письма
            // Если у нас уже есть письмо с таким же текстом и временем
            const sameTextAction = communications.find(
              (other) =>
                other !== touch &&
                other.time === touch.time &&
                other.source !== 'Звонок',
            );

            if (sameTextAction) {
              console.log(
                `   ⚠️ Пропуск дубликата звонка (уже есть ${sameTextAction.source}) для сделки ${leadId}`,
              );
              return;
            }
          }

          const [y, mon, d, h, m, s] = getDate(touch.time);

          const rowData = [
            leadId, // A
            row[1] || '', // B
            row[2] || '', // C
            row[3] || '', // D
            row[4] || '', // E
            touch.core || '', // F
            touch.source || '', // G
            touch.text || '', // H
            `${touch.source} ${touch.source === 'Письмо' || touch.source === 'Звонок' ? (touch.income ? 'вход' : 'исх') : ''}`, // I
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

          const actionKey = createActionKey(rowData);
          if (actionKey && !existingActions.has(actionKey)) {
            localNewRows.push(rowData);
            existingActions.add(actionKey);

            // Если это первое действие и базовая строка пустая
            if (isBaseRowEmpty && updateRowData.length === 0) {
              shouldUpdateBaseRow = true;
              updateRowData = [...rowData];
            }
          }
        });

        // Обрабатываем задачи
        validTasks.forEach((task) => {
          const [y, mon, d, h, m, s] = getDate(task.created_at);

          const rowData = [
            leadId, // A
            row[1] || '', // B
            row[2] || '', // C
            row[3] || '', // D
            row[4] || '', // E
            'task', // F
            'Задачи', // G
            task.text || '', // H
            'Встреча', // I
            task.is_completed ? 'Да' : 'Нет', // J
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
            localNewRows.push(rowData);
            existingActions.add(actionKey);

            // Если это первое действие и базовая строка пустая
            if (isBaseRowEmpty && updateRowData.length === 0) {
              shouldUpdateBaseRow = true;
              updateRowData = [...rowData];
            }
          }
        });

        // Добавляем обновление базовой строки
        if (shouldUpdateBaseRow && updateRowData.length > 0) {
          updates.push({
            range: `A${currentRowNumber}:R${currentRowNumber}`,
            values: [updateRowData],
          });

          console.log(`   ✏️ Будет обновлена строка ${currentRowNumber}`);

          // Убираем это действие из localNewRows если оно там есть
          const actionKey = createActionKey(updateRowData);
          const actionIndex = localNewRows.findIndex(
            (r) => createActionKey(r) === actionKey,
          );
          if (actionIndex !== -1) {
            localNewRows.splice(actionIndex, 1);
          }
        }

        // Добавляем оставшиеся новые строки
        if (localNewRows.length > 0) {
          newRows.push(...localNewRows);
          console.log(`   ➕ Добавлено ${localNewRows.length} новых действий`);
        }

        // Прогресс каждые 50 сделок
        if ((i + 1) % 50 === 0) {
          console.log(
            `\n📊 Прогресс: ${i + 1}/${allRows.length} сделок обработано`,
          );
          console.log(
            `   Собрано: ${updates.length} обновлений, ${newRows.length} новых строк`,
          );

          // Можно сделать небольшую паузу после каждых 50 сделок
          await delay(1000);
        }
      } catch (error) {
        console.error(`❌ Ошибка обработки сделки ${leadId}:`, error);

        // Пауза после ошибки
        await delay(500);
      }
    }

    // Выполняем пакетные операции
    console.log(
      `\n📊 Итоги: ${updates.length} обновлений, ${newRows.length} новых строк`,
    );

    // 1. Пакетное обновление существующих строк
    if (updates.length > 0) {
      console.log(`\n🔄 Выполнение ${updates.length} обновлений...`);

      const UPDATE_BATCH_SIZE = 30;

      for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
        const batch = updates.slice(i, i + UPDATE_BATCH_SIZE);
        const batchNumber = Math.floor(i / UPDATE_BATCH_SIZE) + 1;

        console.log(
          `   💾 Обновление пакета ${batchNumber} (${batch.length} строк)`,
        );

        try {
          await sheetService.batchUpdateCells(batch);
        } catch (error) {
          console.error(
            `   ❌ Ошибка обновления пакета ${batchNumber}:`,
            error,
          );
        }

        // Задержка между пакетами обновлений
        if (i + UPDATE_BATCH_SIZE < updates.length) {
          await delay(2000);
        }
      }
    }

    // 2. Пакетное добавление новых строк
    if (newRows.length > 0) {
      console.log(`\n➕ Добавление ${newRows.length} новых строк...`);

      const CREATE_BATCH_SIZE = 100;

      for (let i = 0; i < newRows.length; i += CREATE_BATCH_SIZE) {
        const batch = newRows.slice(i, i + CREATE_BATCH_SIZE);
        const batchNumber = Math.floor(i / CREATE_BATCH_SIZE) + 1;

        console.log(
          `   💾 Запись пакета ${batchNumber} (${batch.length} строк)`,
        );

        try {
          await sheetService.createGoogleFieldsBatch({ values: batch });
        } catch (error) {
          console.error(`   ❌ Ошибка записи пакета ${batchNumber}:`, error);

          // Пробуем записать меньшими пакетами
          const SMALL_BATCH = 20;
          for (let j = 0; j < batch.length; j += SMALL_BATCH) {
            const smallBatch = batch.slice(j, j + SMALL_BATCH);
            try {
              await sheetService.createGoogleFieldsBatch({
                values: smallBatch,
              });
              await delay(500);
            } catch (smallError) {
              console.error('   ❌ Ошибка записи малого пакета:', smallError);
            }
          }
        }

        // Задержка между пакетами
        if (i + CREATE_BATCH_SIZE < newRows.length) {
          await delay(2000);
        }
      }
    }

    console.log(`\n✅ Обновление полей завершено`);
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
