import { ArrayMinSize, IsArray, IsInt, Max, Min } from 'class-validator';

export class PresignPartsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10000, { each: true })
  partNumbers!: number[];
}
