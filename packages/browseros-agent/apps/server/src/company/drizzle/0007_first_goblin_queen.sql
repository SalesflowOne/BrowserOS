CREATE TABLE `installed_skills` (
	`name` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`install_source` text,
	`installed_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
