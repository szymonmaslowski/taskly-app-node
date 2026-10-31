#!/usr/bin/env bash
# Runs in the publish job from the base checkout. It runs no code from the pull request: the patch is re-validated,
# applied with git and pushed; everything else is GitHub API calls.
set -euo pipefail

marker='<!-- testeragent-report -->'
branch="${HEAD_REF}--agent-tests"
report="out/report.md"
max_body_length=60000

complete_check() {
  local conclusion="$1" title="$2" summary_file="$3"
  gh api -X PATCH "repos/$REPOSITORY/check-runs/$CHECK_RUN_ID" -f status=completed -f conclusion="$conclusion" \
    -f "output[title]=$title" -F "output[summary]=@$summary_file" > /dev/null
}

current_head="$(gh api "repos/$REPOSITORY/pulls/$NUMBER" --jq .head.sha)"
if [[ "$current_head" != "$HEAD_SHA" ]]; then
  echo "The pull request moved on to $current_head, so a newer run publishes its results." | tee "$RUNNER_TEMP/superseded.md"
  complete_check neutral "Superseded by a newer commit" "$RUNNER_TEMP/superseded.md"
  exit 0
fi

stacked_number=""
if [[ -s out/patch.diff ]]; then
  node base/agent/src/ci.ts validate-patch --checkout head --patch out/patch.diff
  git -C head checkout -q -B "$branch"
  git -C head apply ../out/patch.diff
  git -C head add -A
  git -C head -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    commit -q -m "test: add agent tests for #$NUMBER" -m "Written by the test agent for $HEAD_SHA." -m "Run: $RUN_URL"
  auth="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
  git -C head -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $auth" \
    push -q --force "https://github.com/$REPOSITORY.git" "HEAD:refs/heads/$branch"

  stacked_body="$RUNNER_TEMP/stacked.md"
  {
    echo "Tests written by the test agent for #$NUMBER. Merge this pull request into the source branch to add them."
    echo
    head -c "$max_body_length" "$report"
    echo
    echo "<!-- testeragent:source=$HEAD_SHA -->"
  } > "$stacked_body"
  owner="${REPOSITORY%%/*}"
  stacked_number="$(gh api -X GET "repos/$REPOSITORY/pulls" -f head="$owner:$branch" -f state=open --jq '.[0].number // empty')"
  if [[ -n "$stacked_number" ]]; then
    gh api -X PATCH "repos/$REPOSITORY/pulls/$stacked_number" -F "body=@$stacked_body" > /dev/null
  else
    stacked_number="$(gh api "repos/$REPOSITORY/pulls" -f title="Agent tests for #$NUMBER" -f head="$branch" -f base="$HEAD_REF" \
      -F "body=@$stacked_body" --jq .number)"
  fi
fi

if [[ "$APPLIED" != "true" ]]; then
  conclusion=failure
  headline="the agent couldn't produce passing tests, so nothing was published."
elif [[ -n "$stacked_number" ]]; then
  conclusion=neutral
  headline="review the new tests in #$stacked_number."
else
  conclusion=success
  headline="no tests needed for this change."
fi

comment="$RUNNER_TEMP/comment.md"
{
  echo "$marker"
  echo "**Test agent:** $headline [Run]($RUN_URL)"
  echo
  head -c "$max_body_length" "$report"
} > "$comment"
existing_comment="$(gh api --paginate "repos/$REPOSITORY/issues/$NUMBER/comments" \
  --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | contains(\"$marker\"))) | .id" | head -n 1)"
if [[ -n "$existing_comment" ]]; then
  gh api -X PATCH "repos/$REPOSITORY/issues/comments/$existing_comment" -F "body=@$comment" > /dev/null
else
  gh api "repos/$REPOSITORY/issues/$NUMBER/comments" -F "body=@$comment" > /dev/null
fi

case "$conclusion" in
  failure) title="Agent couldn't produce passing tests" ;;
  neutral) title="Review agent tests in #$stacked_number" ;;
  *) title="No tests needed" ;;
esac
complete_check "$conclusion" "$title" "$comment"
cat "$comment" >> "$GITHUB_STEP_SUMMARY"
