import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { errorMessage, myUploadsApi } from '@glazion/api-client';
import { UploadStatus } from '@glazion/types';
import { Icon, clayBodyLabel, formatBytes, formatDateTime, toneClass, uploadStatusMeta } from '@glazion/ui';

export default function UploadDetailPage() {
  const { uploadId } = useParams<{ uploadId: string }>();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['my-uploads', uploadId],
    queryFn: () => myUploadsApi.getOne(uploadId!),
    enabled: !!uploadId,
  });
  const upload = query.data;
  const status = upload ? uploadStatusMeta(upload.status) : null;

  return (
    <>
      <header className="topbar">
        <button className="btn btn-ghost btn-icon" onClick={() => navigate('/history')} aria-label="Back to uploads">
          <Icon name="chevron-left" size={22} />
        </button>
        <h1 className="topbar-title">Upload</h1>
        <span className="topbar-spacer" />
      </header>

      {query.isPending && (
        <div className="page-loading">
          <span className="spinner spinner-lg" />
        </div>
      )}

      {query.isError && (
        <div className="empty">
          <div className="empty-icon">
            <Icon name="alert" size={22} />
          </div>
          <div className="empty-title">Couldn’t open this upload</div>
          <p className="empty-text">{errorMessage(query.error)}</p>
          <Link className="btn btn-secondary" to="/history">
            Back to uploads
          </Link>
        </div>
      )}

      {upload && status && (
        <main className="page detail">
          <div className="detail-image">
            {upload.downloadUrl ? <img src={upload.downloadUrl} alt="Uploaded tile" /> : <Icon name="image" size={32} />}
          </div>

          <div className="detail-head">
            <h1 className="detail-name">{upload.fileName ?? 'Untitled photo'}</h1>
            <span className={toneClass(status.tone)}>{status.label}</span>
          </div>

          {upload.status === UploadStatus.Rejected && (
            <div className="alert" role="note">
              <Icon name="alert" size={18} />
              <span>
                <strong>Rejected.</strong> {upload.reviewNote ?? 'No reason was given. Ask your admin what to change.'}
              </span>
            </div>
          )}

          {upload.status === UploadStatus.Failed && (
            <div className="alert" role="note">
              <Icon name="alert" size={18} />
              <span>{upload.failureReason ?? 'This photo couldn’t be processed. Try uploading it again.'}</span>
            </div>
          )}

          <dl className="facts">
            {(upload.recipeCode || upload.recipeName) && (
              <div>
                <dt>Recipe</dt>
                <dd className="facts-recipe">
                  {upload.recipeCode && <span className="tile-code">{upload.recipeCode}</span>}
                  {upload.recipeName && upload.recipeName !== upload.recipeCode && <span>{upload.recipeName}</span>}
                </dd>
              </div>
            )}
            {upload.clayBody && (
              <div>
                <dt>Clay body</dt>
                <dd>{clayBodyLabel(upload.clayBody)}</dd>
              </div>
            )}
            <div>
              <dt>Submitted</dt>
              <dd>{formatDateTime(upload.createdAt)}</dd>
            </div>
            {upload.reviewedAt && (
              <div>
                <dt>Reviewed</dt>
                <dd>{formatDateTime(upload.reviewedAt)}</dd>
              </div>
            )}
            <div>
              <dt>Size</dt>
              <dd>{formatBytes(upload.actualSizeBytes ?? upload.declaredSizeBytes)}</dd>
            </div>
            {upload.status !== UploadStatus.Rejected && upload.reviewNote && (
              <div>
                <dt>Reviewer note</dt>
                <dd>{upload.reviewNote}</dd>
              </div>
            )}
          </dl>
        </main>
      )}
    </>
  );
}
