import { formatDate, getDate, getFieldValue } from '../util/helper';
import { ControlSheetService } from '../services/apiGoogleTable';
import { getLeadsTodayOrByPeriod } from './utils';
import { DOMAIN } from './contants';
import {
  incomingActionDateFromContact,
  incomingCallDate,
} from './updateFields';
import { AmoAPI } from '../services/apiAmo';
import {
  LeadResponsibleChangedEvent,
  LeadStatusChangedEvent,
  Task,
} from '../interfaces';
import { getStatusLead } from './statusList';
import { ReportRowFactory } from './table/tableFabricControl';

// const lastColumnName = 'AE';

// Функция создания базовых строк
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
    const allRows = await sheetService.getRangeValues();
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
          const createdAtFormatted = formatDate(lead.created_at);
          const [year, month, day] = getDate(lead.created_at);
          const leadPipeline = pipelinesMap[lead.pipeline_id];
          const statusLead = getStatusLead({
            statusId: lead.status_id,
            pipelineId: lead.pipeline_id,
          });
          const row = ReportRowFactory.createBaseRow({
            leadId: lead.id,
            name: lead.name,
            url: `https://${DOMAIN}.amocrm.ru/leads/detail/${lead.id}`,
            createdAtFormatted,
            day,
            month,
            year,
            status: statusLead,
            pipeline: leadPipeline,
            createAt: lead.created_at,
          });

          return row;
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

// Функция обновления полей
export const updateReportControlDaily = async (): Promise<void> => {
  try {
    const sheetService = new ControlSheetService();
    const amo = new AmoAPI();

    const pipelinesResponse = await amo.getAllPipelines();
    const pipelinesMap = pipelinesResponse.reduce(
      (
        acc: { [key: number]: string },
        pipeline: { id: number; name: string },
      ) => {
        acc[pipeline.id] = pipeline.name;
        return acc;
      },
      {},
    );

    // Инициализируем кэш пользователей
    await amo.initUsersCache();

    // Получаем все строки таблицы
    const allRows = await sheetService.getRangeValues();
    console.log(`📊 Найдено ${allRows.length} строк в таблице`);

    // ГРУППИРУЕМ строки по ID сделки
    const leadsMap = new Map<
      number,
      Array<{
        row: (string | number)[];
        rowNumber: number;
        isBaseRow?: boolean;
      }>
    >();

    // Собираем ВСЕ существующие действия для сравнения
    const existingActions = new Set<string>();

    // ЗАПОЛНЯЕМ leadsMap ДАННЫМИ ИЗ allRows
    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      const rowNumber = i + 2;
      const leadId = Number(row[0]);

      if (!leadId || isNaN(leadId)) {
        continue;
      }

      // Добавляем строку в группу по ID сделки
      if (!leadsMap.has(leadId)) {
        leadsMap.set(leadId, []);
      }

      // Определяем, является ли строка базовой
      const isBaseRow = ReportRowFactory.isBaseRowEmpty(row);
      leadsMap.get(leadId)!.push({
        row,
        rowNumber,
        isBaseRow,
      });

      // Собираем ключи существующих действий
      const actionKey = createActionKey(row);
      if (actionKey) {
        existingActions.add(actionKey);
      }
    }

    console.log(
      `🎯 Обработка ${leadsMap.size} уникальных сделок (из ${allRows.length} строк)`,
    );

    // Массивы для пакетной обработки
    const updates: Array<{ range: string; values: any[][] }> = [];
    const newRows: (string | number)[][] = [];

    // Функция для задержки
    const delay = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    // Получаем список уникальных сделок
    const leadIds = Array.from(leadsMap.keys());

    // Обрабатываем УНИКАЛЬНЫЕ сделки
    for (let i = 0; i < leadIds.length; i++) {
      const leadId = leadIds[i];
      const leadRows = leadsMap.get(leadId)!;

      // Находим базовую строку сделки
      const baseRowInfo = leadRows.find((r) => r.isBaseRow) || leadRows[0];
      const baseRowArray = baseRowInfo.row;
      const baseRowNumber = baseRowInfo.rowNumber;

      if (!leadId || isNaN(leadId)) {
        console.log(`⏭️ Сделка ${leadId}: пропуск, некорректный ID`);
        continue;
      }

      console.log(
        `\n🔄 [${i + 1}/${leadIds.length}] Обработка сделки ${leadId} (${leadRows.length} строк)`,
      );

      try {
        // Задержка между запросами к amoCRM
        if (i > 0) {
          await delay(150);
        }

        // Создаем BaseRowData для фабрики
        const baseRowData = ReportRowFactory.createBaseRowDataFromArray(
          baseRowArray,
          leadId,
        );

        // 1. ОБНОВЛЕНИЕ ОТВЕТСТВЕННОГО
        console.log(`   👤 Получение актуальных данных сделки...`);
        let currentResponsible = '';
        try {
          const currentLeadData = await amo.getLeadById(leadId);
          if (currentLeadData && currentLeadData.responsible_user_id) {
            const user = await amo.getUser(currentLeadData.responsible_user_id);
            currentResponsible = user ? user.name : '';
            console.log(`   👤 Текущий ответственный: ${currentResponsible}`);
          }
        } catch (error) {
          if (error instanceof Error)
            console.log(
              `   ⚠️ Не удалось получить данные сделки: ${error.message}`,
            );
        }

        if (currentResponsible && currentResponsible !== baseRowArray[4]) {
          console.log(
            `   ✏️ Обновление ответственного с "${baseRowArray[4]}" на "${currentResponsible}"`,
          );
          updates.push({
            range: `E${baseRowNumber}:E${baseRowNumber}`,
            values: [[currentResponsible]],
          });
          baseRowArray[4] = currentResponsible;
          baseRowData.responsible = currentResponsible;
        }

        // Получаем timestamp для запросов
        let createdAtTimestamp: number;
        try {
          const leadCreatedAt = baseRowArray[3];
          createdAtTimestamp = Math.floor(
            new Date(leadCreatedAt).getTime() / 1000,
          );
        } catch {
          createdAtTimestamp = Math.floor(Date.now() / 1000);
        }

        // 2. ПОЛУЧИТЬ ДАННЫЕ ДЛЯ НОВЫХ СТРОК
        let fromContact = null;
        let fromNotes = null;
        let tasks: Task[] = [];
        let leadStatusChanged: LeadStatusChangedEvent[] = [];
        let leadResponsibleChanged: LeadResponsibleChangedEvent[] = [];

        try {
          console.log(`   📞 Получение контактов...`);
          fromContact = await incomingActionDateFromContact(
            leadId,
            createdAtTimestamp,
          );
          await delay(100);

          console.log(`   📝 Получение примечаний...`);
          fromNotes = await incomingCallDate(leadId);
          await delay(100);

          console.log(`   ✅ Получение задач...`);
          tasks = await amo.getTasks(leadId);
          await delay(100);

          console.log(`   ✅ Получение статусов...`);
          leadStatusChanged = await amo.getStatusChanged(leadId);
          await delay(100);

          console.log(`   ✅ Получение ответственных...`);
          leadResponsibleChanged = await amo.getResponsibleChanged(leadId);
        } catch (error) {
          console.error(
            `   ⚠️ Ошибка получения данных для сделки ${leadId}:`,
            error,
          );
          continue;
        }

        const communications = [
          ...(fromContact?.communications || []),
          ...(fromNotes?.communications || []),
        ];
        const validTasks = tasks.filter((t) => t.result.text || t.text);

        if (
          !validTasks.length &&
          !communications.length &&
          !leadStatusChanged.length &&
          !leadResponsibleChanged.length
        ) {
          console.log(`   ⏭️ Нет новых действий для сделки ${leadId}`);
          continue;
        }

        console.log(
          `   📊 Найдено действий: ${communications.length} комм., ${validTasks.length} задач, ` +
            `${leadStatusChanged.length} статусов, ${leadResponsibleChanged.length} ответственных`,
        );

        // 3. ПОДГОТОВИТЬ ВСЕ ДЕЙСТВИЯ В ОДИН МАССИВ
        const allActions: Array<{
          type:
            | 'communication'
            | 'task'
            | 'status_change'
            | 'responsible_change';
          data: any;
          timestamp: number;
        }> = [];

        // Добавляем коммуникации
        communications.forEach((touch) => {
          allActions.push({
            type: 'communication',
            data: touch,
            timestamp: touch.time,
          });
        });

        // Добавляем задачи
        validTasks.forEach((task) => {
          allActions.push({
            type: 'task',
            data: task,
            timestamp: task.created_at,
          });
        });

        // Добавляем смены статусов
        leadStatusChanged.forEach((statusChange) => {
          allActions.push({
            type: 'status_change',
            data: statusChange,
            timestamp: statusChange.created_at,
          });
        });

        // Добавляем смены ответственных
        leadResponsibleChanged.forEach((respChange) => {
          allActions.push({
            type: 'responsible_change',
            data: respChange,
            timestamp: respChange.created_at,
          });
        });

        // Сортируем все действия по времени
        allActions.sort((a, b) => a.timestamp - b.timestamp);

        // 4. ОБРАБОТАТЬ ВСЕ ДЕЙСТВИЯ С ИСПОЛЬЗОВАНИЕМ ФАБРИКИ
        const localNewRows: (string | number)[][] = [];
        let firstActionProcessed = false;
        const isBaseRowEmpty = ReportRowFactory.isBaseRowEmpty(baseRowArray);

        for (const action of allActions) {
          try {
            // Создаем базовые параметры для фабрики
            const factoryParams = {
              baseRow: baseRowData,
              amo,
              pipelinesMap,
              isFirstAction: !firstActionProcessed && isBaseRowEmpty,
            };

            // Создаем строку с помощью фабрики
            let rowData: (string | number)[];

            switch (action.type) {
              case 'communication':
                rowData = await ReportRowFactory.createRow({
                  ...factoryParams,
                  type: 'communication',
                  touch: action.data,
                });
                break;
              case 'task':
                rowData = await ReportRowFactory.createRow({
                  ...factoryParams,
                  type: 'task',
                  task: action.data,
                });
                break;
              case 'status_change':
                rowData = await ReportRowFactory.createRow({
                  ...factoryParams,
                  type: 'status_change',
                  statusChange: action.data,
                });
                break;
              case 'responsible_change':
                rowData = await ReportRowFactory.createRow({
                  ...factoryParams,
                  type: 'responsible_change',
                  respChange: action.data,
                });
                break;
              default:
                continue;
            }

            const actionKey = createActionKey(rowData);
            if (!actionKey || existingActions.has(actionKey)) {
              continue;
            }

            // ДЕБАГ: Проверяем данные перед отправкой
            console.log('🔍 Проверка дат в строке:', {
              'row[11] (L)': rowData[11],
              'row[12] (M)': rowData[12],
              'row[14] (O)': rowData[14],
              'row[15] (P)': rowData[15],
              'row[16] (Q)': rowData[16],
              'row[29] (AD)': rowData[29],
              'row[30] (AE)': rowData[30],
            });

            // Если это первое действие и базовая строка пустая - обновляем базовую строку
            if (!firstActionProcessed && isBaseRowEmpty) {
              console.log(
                `   ✏️ Заполнение базовой строки первым действием (тип: ${action.type})`,
              );

              updates.push({
                range: `A${baseRowNumber}:AE${baseRowNumber}`,
                values: [rowData],
              });

              // Обновляем локальную копию базовой строки
              for (let j = 0; j < rowData.length; j++) {
                baseRowArray[j] = rowData[j];
              }

              // Обновляем baseRowData для следующих действий
              Object.assign(
                baseRowData,
                ReportRowFactory.createBaseRowDataFromArray(rowData, leadId),
              );

              firstActionProcessed = true;
            } else {
              // Все остальные действия добавляем как новые строки
              localNewRows.push(rowData);
            }

            existingActions.add(actionKey);
          } catch (error) {
            // Пропускаем ошибки создания (например, звонки без ссылки)
            if (error instanceof Error)
              console.log(
                `   ⚠️ Пропуск действия (ошибка создания):`,
                error.message,
              );
            continue;
          }
        }

        // 5. ДОБАВИТЬ ОСТАЛЬНЫЕ НОВЫЕ СТРОКИ
        if (localNewRows.length > 0) {
          newRows.push(...localNewRows);
          console.log(`   ➕ Добавлено ${localNewRows.length} новых действий`);
        }

        // Прогресс
        if ((i + 1) % 20 === 0) {
          console.log(
            `\n📊 Прогресс: ${i + 1}/${leadIds.length} сделок обработано`,
          );
          console.log(
            `   Собрано: ${updates.length} обновлений, ${newRows.length} новых строк`,
          );
          await delay(1000);
        }
      } catch (error) {
        console.error(`❌ Ошибка обработки сделки ${leadId}:`, error);
        await delay(500);
      }
    }

    // 6. ВЫПОЛНИТЬ ПАКЕТНЫЕ ОПЕРАЦИИ (остается без изменений)
    console.log(
      `\n📊 Итоги: ${updates.length} обновлений, ${newRows.length} новых строк`,
    );

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

        if (i + UPDATE_BATCH_SIZE < updates.length) {
          await delay(2000);
        }
      }
    }

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
function createActionKey(rowData: (string | number)[]): string | null {
  if (!rowData || rowData.length === 0) return null;

  const leadId = rowData[0];
  const source = rowData[6]; // G

  // Для событий этапов/воронок
  if (source === 'Этап/Воронка') {
    const oldStatus = rowData[23]; // X
    const newStatus = rowData[25]; // Z
    const date = rowData[11] || rowData[20]; // L или U
    const time = rowData[12] || rowData[21]; // M или V
    return `stage_${leadId}_${oldStatus}_${newStatus}_${date}_${time}`;
  }

  // Для смены ответственного
  if (source === 'Смена ответственного') {
    const oldResp = rowData[26]; // AA
    const newResp = rowData[27]; // AB
    const date = rowData[29]; // AD
    const time = rowData[30]; // AE
    return `resp_${leadId}_${oldResp}_${newResp}_${date}_${time}`;
  }

  // Для обычных действий
  const text = rowData[7]; // H
  const date = rowData[11]; // L
  const time = rowData[12]; // M
  return `default_${leadId}_${source}_${text}_${date}_${time}`;
}
