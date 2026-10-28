import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CompletedUploadPartDto {
  @IsInt()
  @Min(1)
  partNumber!: number;

  @IsString()
  etag!: string;
}

export class CompleteUploadDto {
  @IsString()
  uploadId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CompletedUploadPartDto)
  parts!: CompletedUploadPartDto[];
}
