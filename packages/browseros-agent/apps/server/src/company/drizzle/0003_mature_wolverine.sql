DELETE FROM `approvals` WHERE `surface` = 'channel';--> statement-breakpoint
DELETE FROM `messages` WHERE `surface` = 'channel';--> statement-breakpoint
DROP TABLE `channel_members`;--> statement-breakpoint
DROP TABLE `channels`;
