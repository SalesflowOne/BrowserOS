package ui

import "github.com/fatih/color"

var (
	titleColor   = color.New(color.Bold, color.FgCyan)
	labelColor   = color.New(color.Bold)
	valueColor   = color.New(color.FgHiWhite)
	successColor = color.New(color.FgGreen, color.Bold)
	warnColor    = color.New(color.FgYellow, color.Bold)
	errorColor   = color.New(color.FgRed, color.Bold)
	mutedColor   = color.New(color.Faint)
)

func Title(value string) string   { return titleColor.Sprint(value) }
func Label(value string) string   { return labelColor.Sprint(value) }
func Value(value string) string   { return valueColor.Sprint(value) }
func Success(value string) string { return successColor.Sprint(value) }
func Warn(value string) string    { return warnColor.Sprint(value) }
func Error(value string) string   { return errorColor.Sprint(value) }
func Muted(value string) string   { return mutedColor.Sprint(value) }
