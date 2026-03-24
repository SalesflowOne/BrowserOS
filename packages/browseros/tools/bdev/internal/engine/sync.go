package engine

import (
	"bdev/internal/git"
	"bdev/internal/patch"
	"bdev/internal/session"
	"bdev/internal/ui"
)

type SyncResult struct {
	Updated  []string
	Session  *session.Session
	RepoHead string
}

func Sync(ctx *Context, activity *ui.Activity) (*SyncResult, error) {
	if ctx.Checkout.LastSyncedRev == "" {
		applyResult, err := ApplyAll(ctx, ApplyAllOpts{Clean: true}, activity)
		if err != nil {
			return nil, err
		}
		return &SyncResult{
			Updated:  applyResult.Applied,
			Session:  applyResult.Session,
			RepoHead: applyResult.RepoHead,
		}, nil
	}
	if err := requireCleanPatchRepo(ctx); err != nil {
		return nil, err
	}
	head, err := git.HeadRev(ctx.PatchRepo.BrowserOSRepo)
	if err != nil {
		return nil, err
	}
	result := &SyncResult{RepoHead: head}
	if head == ctx.Checkout.LastSyncedRev {
		return result, nil
	}
	changedPaths, err := git.DiffChangedPathsBetween(ctx.PatchRepo.BrowserOSRepo, ctx.Checkout.LastSyncedRev, head)
	if err != nil {
		return nil, err
	}
	localStatus, err := git.DiffNameStatus(ctx.Checkout.ChromiumRoot, ctx.PatchRepo.BaseCommit)
	if err != nil {
		return nil, err
	}
	overlap := intersect(localStatus, changedPaths)
	if len(overlap) > 0 {
		return nil, fail("local changes overlap upstream patch changes; run bdev rebase")
	}
	sess := &session.Session{
		CheckoutID:  ctx.Checkout.ID,
		Kind:        "sync",
		FromRepoRev: ctx.Checkout.LastSyncedRev,
		ToRepoRev:   head,
	}
	for _, path := range changedPaths {
		fp, ok, err := patch.ReadCurrentPatch(ctx.PatchRepo.BrowserOSRepo, path)
		if err != nil {
			return nil, err
		}
		if err := resetPathToBase(ctx, path); err != nil {
			return nil, err
		}
		if !ok || fp.Op == patch.OpDeleted {
			result.Updated = append(result.Updated, path)
			continue
		}
		detail, err := git.Apply(ctx.Checkout.ChromiumRoot, fp.Content)
		if err != nil || detail != "" {
			sess.Pending = append(sess.Pending, session.ConflictEntry{
				Path: path, Stage: "sync", PatchContent: string(fp.Content), Error: detail,
			})
			continue
		}
		result.Updated = append(result.Updated, path)
	}
	if len(sess.Pending) > 0 {
		if err := session.Save(sess); err != nil {
			return nil, err
		}
		result.Session = sess
		return result, nil
	}
	if err := session.Delete(ctx.Checkout.ID); err != nil {
		return nil, err
	}
	return result, nil
}
