package engine

import (
	"bdev/internal/patchrepo"
	"bdev/internal/registry"
)

type Context struct {
	Checkout  *registry.CheckoutRecord
	PatchRepo *patchrepo.Context
}

func NewContext(record *registry.CheckoutRecord, patchCtx *patchrepo.Context) *Context {
	return &Context{
		Checkout:  record,
		PatchRepo: patchCtx,
	}
}
