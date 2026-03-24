package engine

import (
	"bdev/internal/session"
)

func ResetToBase(ctx *Context) error {
	if err := resetAllToBase(ctx); err != nil {
		return err
	}
	return session.Delete(ctx.Checkout.ID)
}
