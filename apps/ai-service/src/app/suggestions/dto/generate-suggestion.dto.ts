import { IsIn } from 'class-validator';
import {
  SUGGESTION_TASKS,
  type SuggestionTask,
} from '../../../domain/suggestion';

export class GenerateSuggestionDto {
  /** Which of the four assistance tasks to run for this ticket. */
  @IsIn(SUGGESTION_TASKS)
  task!: SuggestionTask;
}
