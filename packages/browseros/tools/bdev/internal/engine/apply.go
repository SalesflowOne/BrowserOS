package engine

import (
	"slices"

	"bdev/internal/feature"
	"bdev/internal/git"
	"bdev/internal/patch"
	"bdev/internal/session"
	"bdev/internal/ui"
)

type ApplyAllOpts struct {
	Clean      bool
	TagFeature string
}

type ApplyResult struct {
	Applied  []string
	Deleted  []string
	Session  *session.Session
	RepoHead string
	Warnings []string
}

func ApplyAll(ctx *Context, opts ApplyAllOpts, activity *ui.Activity) (*ApplyResult, error) {
	if err := requireCleanPatchRepo(ctx); err != nil {
		return nil, err
	}
	done := activity.Start("load patch set")
	patchSet, err := patch.ReadCurrentPatchSet(ctx.PatchRepo.BrowserOSRepo)
	done(err == nil, "")
	if err != nil {
		return nil, err
	}
	if opts.Clean {
		done = activity.Start("reset checkout to base")
		err = resetAllToBase(ctx)
		done(err == nil, "")
		if err != nil {
			return nil, err
		}
	}
	paths := make([]string, 0, len(patchSet))
	for path := range patchSet {
		paths = append(paths, path)
	}
	slices.Sort(paths)
	result := &ApplyResult{}
	sess := &session.Session{
		CheckoutID: ctx.Checkout.ID,
		Kind:       "apply",
	}
	head, err := git.HeadRev(ctx.PatchRepo.BrowserOSRepo)
	if err != nil {
		return nil, err
	}
	result.RepoHead = head
	sess.ToRepoRev = head
	for _, path := range paths {
		fp := patchSet[path]
		switch fp.Op {
		case patch.OpDeleted:
			if err := resetPathToBase(ctx, path); err != nil {
				return nil, err
			}
			result.Deleted = append(result.Deleted, path)
		default:
			if err := resetPathToBase(ctx, path); err != nil {
				return nil, err
			}
			detail, err := git.Apply(ctx.Checkout.ChromiumRoot, fp.Content)
			if err != nil || detail != "" {
				sess.Pending = append(sess.Pending, session.ConflictEntry{
					Path:         path,
					Stage:        "apply",
					PatchContent: string(fp.Content),
					Error:        detail,
				})
				continue
			}
			result.Applied = append(result.Applied, path)
		}
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
	if opts.TagFeature != "" {
		if err := feature.TagFeature(feature.TagFeatureOpts{
			BrowserOSRepo: ctx.PatchRepo.BrowserOSRepo,
			FeatureName:   opts.TagFeature,
			Paths:         append(append([]string{}, result.Applied...), result.Deleted...),
		}); err != nil {
			result.Warnings = append(result.Warnings, err.Error())
		}
	}
	return result, nil
}
