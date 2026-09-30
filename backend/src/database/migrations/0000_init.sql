CREATE TABLE "document_contents" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"total_chars" integer NOT NULL,
	"indexed_chars" integer NOT NULL,
	"is_partially_indexed" boolean NOT NULL,
	"search_vector" "tsvector" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"category" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" text,
	"format" text NOT NULL,
	"original_filename" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"file_sha256" char(64) NOT NULL,
	"status" text DEFAULT 'PROCESANDO' NOT NULL,
	"last_error_code" text,
	"last_error_detail" text,
	"last_error_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"indexed_at" timestamp with time zone,
	CONSTRAINT "documents_file_sha256_key" UNIQUE("file_sha256"),
	CONSTRAINT "documents_status_check" CHECK ("documents"."status" in ('PROCESANDO', 'INDEXADO', 'ERROR')),
	CONSTRAINT "documents_format_check" CHECK ("documents"."format" in ('TXT', 'MARKDOWN', 'PDF')),
	CONSTRAINT "documents_error_requires_code_check" CHECK ("documents"."status" <> 'ERROR' or "documents"."last_error_code" is not null)
);
--> statement-breakpoint
ALTER TABLE "document_contents" ADD CONSTRAINT "document_contents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_contents_search_vector_idx" ON "document_contents" USING gin ("search_vector");